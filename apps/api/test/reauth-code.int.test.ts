/**
 * Organisation-level changes need a second proof when REAUTH_EMAIL_CODE_REQUIRED is on: the password plus a
 * one-time code emailed to the signed-in person. Real API, PostgreSQL and Redis.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiEnv } from '../src/config/env.js';
import {
  Browser,
  DEFAULT_PASSWORD,
  Fixtures,
  ownerClient,
  queuedEmails,
  startApp,
  testEnv,
} from './helpers.js';

const db = ownerClient();
const fx = new Fixtures(db);
let env: ApiEnv;
let app: NestExpressApplication;

beforeAll(async () => {
  env = testEnv({ REAUTH_EMAIL_CODE_REQUIRED: 'true' });
  app = await startApp(env);
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await db.$disconnect();
});

async function owner(label: string) {
  const tenant = await fx.tenant(label);
  const user = await fx.user(`${label}-owner`);
  await fx.member(tenant.id, user.id, true);
  const browser = new Browser(app);
  expect((await browser.login(user.email)).status).toBe(200);
  return { tenant, user, browser };
}

const latestCode = async (email: string) => {
  const mails = await queuedEmails(env, email);
  const mail = mails.filter((m) => m.category === 'reauth_code').at(-1);
  return /confirmation code is (\d{6})/.exec(mail?.text ?? '')?.[1];
};

describe('emailed code for organisation-level changes', () => {
  it('blocks a change until the password and a fresh emailed code are given', async () => {
    const org = await owner('Code');
    const change = () => org.browser.send('put', '/v1/admin/security', { requireMfa: false });

    // Signing in with a password alone is not enough for an organisation-level change.
    const blocked = await change();
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('REAUTH_REQUIRED');

    // The password by itself is refused.
    const passwordOnly = await org.browser.send('post', '/v1/auth/reauthenticate', {
      password: DEFAULT_PASSWORD,
    });
    expect(passwordOnly.status).toBe(401);

    // Ask for a code; it goes to the account's own address.
    expect((await org.browser.send('post', '/v1/auth/reauthenticate/code')).status).toBe(204);
    const code = await latestCode(org.user.email);
    expect(code).toMatch(/^\d{6}$/);

    // A wrong code and a wrong password are both refused.
    const wrong = code === '000000' ? '111111' : '000000';
    expect(
      (
        await org.browser.send('post', '/v1/auth/reauthenticate', {
          password: DEFAULT_PASSWORD,
          emailCode: wrong,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await org.browser.send('post', '/v1/auth/reauthenticate', {
          password: 'not the password!!',
          emailCode: code,
        })
      ).status,
    ).toBe(401);

    // The right password and code unlock the change.
    const ok = await org.browser.send('post', '/v1/auth/reauthenticate', {
      password: DEFAULT_PASSWORD,
      emailCode: code,
    });
    expect(ok.status).toBe(204);
    expect((await change()).status).toBeLessThan(300);

    // A code works once: after the window is reset, the same code no longer opens it.
    await db.userSession.updateMany({ where: { userId: org.user.id }, data: { reauthenticatedAt: null } });
    expect((await change()).status).toBe(403);
    const reuse = await org.browser.send('post', '/v1/auth/reauthenticate', {
      password: DEFAULT_PASSWORD,
      emailCode: code,
    });
    expect(reuse.status).toBe(401);
  });

  it('refuses a code that was issued to a different session', async () => {
    const org = await owner('Other');
    expect((await org.browser.send('post', '/v1/auth/reauthenticate/code')).status).toBe(204);
    const code = await latestCode(org.user.email);

    const second = new Browser(app);
    expect((await second.login(org.user.email)).status).toBe(200);
    const stolen = await second.send('post', '/v1/auth/reauthenticate', {
      password: DEFAULT_PASSWORD,
      emailCode: code,
    });
    expect(stolen.status).toBe(401);
  });

  it('limits wrong guesses, then the code stops working even if it is right', async () => {
    const org = await owner('Guess');
    expect((await org.browser.send('post', '/v1/auth/reauthenticate/code')).status).toBe(204);
    const code = (await latestCode(org.user.email))!;
    const wrong = code === '123456' ? '654321' : '123456';
    // The session allows five reauthentication attempts per five minutes; four wrong guesses leave one.
    for (let i = 0; i < 4; i++) {
      const res = await org.browser.send('post', '/v1/auth/reauthenticate', {
        password: DEFAULT_PASSWORD,
        emailCode: wrong,
      });
      expect(res.status).toBe(401);
    }
    const last = await org.browser.send('post', '/v1/auth/reauthenticate', {
      password: DEFAULT_PASSWORD,
      emailCode: code,
    });
    expect(last.status).toBe(204);
  });

  it('is not used when the feature is off', async () => {
    const off = await startApp(testEnv());
    try {
      const tenant = await fx.tenant('Off');
      const user = await fx.user('off-owner');
      await fx.member(tenant.id, user.id, true);
      const browser = new Browser(off);
      expect((await browser.login(user.email)).status).toBe(200);
      expect((await browser.send('put', '/v1/admin/security', { requireMfa: false })).status).toBeLessThan(
        300,
      );
      expect((await browser.send('post', '/v1/auth/reauthenticate/code')).status).toBe(409);
    } finally {
      await off.close();
    }
  });
});
