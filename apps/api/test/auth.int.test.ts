/**
 * Authentication, sessions, password recovery and MFA — against the real API, PostgreSQL and Redis.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { generateTotpForTesting, hashToken } from '@smart-hr/auth';
import type { DatabaseClient } from '@smart-hr/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiEnv } from '../src/config/env.js';
import {
  Browser,
  decryptTotpSecret,
  DEFAULT_PASSWORD,
  Fixtures,
  ownerClient,
  queuedEmails,
  resetTokenFrom,
  setCookieLine,
  startApp,
  testEnv,
  WEB_ORIGIN,
} from './helpers.js';

let env: ApiEnv;
let app: NestExpressApplication;
let owner: DatabaseClient;
let fx: Fixtures;
let tenantId: string;

beforeAll(async () => {
  env = testEnv();
  app = await startApp(env);
  owner = ownerClient();
  fx = new Fixtures(owner);
  tenantId = (await fx.tenant('Acme')).id;
});

afterAll(async () => {
  await fx?.cleanup();
  await owner?.$disconnect();
  await app?.close();
});

async function member(label: string, options: Parameters<Fixtures['user']>[1] = {}) {
  const user = await fx.user(label, options);
  await fx.member(tenantId, user.id);
  return user;
}

describe('sign-in', () => {
  it('signs in with correct credentials and sets hardened cookies', async () => {
    const user = await member('valid');
    const browser = new Browser(app);
    const res = await browser.login(user.email.toUpperCase());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      user: { id: user.id, email: user.email, mfaEnabled: false },
      mfaPending: false,
      activeTenant: { id: tenantId, name: 'Acme' },
    });
    const sessionCookie = setCookieLine(res, 'shr_session')!;
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/SameSite=Lax/i);
    expect(setCookieLine(res, 'shr_csrf')).not.toMatch(/HttpOnly/i);

    // Only the hash of the token is stored.
    const stored = await owner.userSession.findFirst({ where: { userId: user.id } });
    expect(stored?.tokenHash).toBe(hashToken(browser.session!));
    expect(stored?.tokenHash).not.toBe(browser.session);
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    const user = await member('wrong');
    const wrong = await new Browser(app).login(user.email, 'not the password at all');
    const unknown = await new Browser(app).login(`nobody-${fx.run}@test.local`, 'not the password at all');

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.code).toBe(wrong.body.code);
    expect(unknown.body.detail).toBe(wrong.body.detail);
    expect(setCookieLine(wrong, 'shr_session')).toBeUndefined();
  });

  it('refuses a disabled account even with the right password, without saying why', async () => {
    const user = await member('disabled', { status: 'DISABLED' });
    const res = await new Browser(app).login(user.email);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('locks the account after repeated failures, then unlocks when the lock expires', async () => {
    const user = await member('lockout');
    for (let i = 0; i < env.AUTH_LOCKOUT_THRESHOLD; i++) {
      expect((await new Browser(app).login(user.email, `wrong password ${i}!!`)).status).toBe(401);
    }
    // Correct password is refused while locked.
    expect((await new Browser(app).login(user.email)).status).toBe(401);
    const locked = await owner.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(
      await owner.auditEvent.count({ where: { actorUserId: user.id, action: 'auth.account.locked' } }),
    ).toBe(1);

    await owner.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await new Browser(app).login(user.email)).status).toBe(200);
  });

  it('rate-limits repeated attempts against one email and says when to retry', async () => {
    const limited = await startApp(
      testEnv({ AUTH_RATE_LIMIT_LOGIN_PER_EMAIL: '3', AUTH_LOCKOUT_THRESHOLD: '50' }),
    );
    try {
      const user = await member('ratelimit');
      const statuses: number[] = [];
      let last: request.Response | undefined;
      for (let i = 0; i < 4; i++) {
        last = await new Browser(limited).login(user.email, 'definitely wrong pw');
        statuses.push(last.status);
      }
      expect(statuses).toEqual([401, 401, 401, 429]);
      expect(last!.body.code).toBe('RATE_LIMITED');
      expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      await limited.close();
    }
  });

  it('rate-limits sign-in attempts from one address across different emails', async () => {
    const limited = await startApp(
      testEnv({ AUTH_RATE_LIMIT_LOGIN_PER_IP: '3', AUTH_LOCKOUT_THRESHOLD: '50' }),
    );
    try {
      // Each attempt uses a different email (whose own limit is far away), so a refusal can only come from
      // the per-address limit. Earlier tests share this address and Redis, so it may trip sooner than the 4th.
      let last: request.Response | undefined;
      for (let i = 0; i < 4; i++) {
        const user = await member(`iplimit${i}`);
        last = await new Browser(limited).login(user.email, 'definitely wrong pw');
      }
      expect(last!.status).toBe(429);
      expect(last!.body.code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });

  it('issues a new session on every sign-in and ends the previous one on that browser', async () => {
    const user = await member('fixation');
    const browser = new Browser(app);
    await browser.login(user.email);
    const first = browser.session!;
    await browser.login(user.email);
    expect(browser.session).not.toBe(first);

    const stale = await request(app.getHttpServer())
      .get('/v1/auth/session')
      .set('Cookie', `shr_session=${first}`);
    expect(stale.status).toBe(401);
  });
});

describe('sessions', () => {
  it('rejects requests without a session, and says when a session has ended', async () => {
    const none = await request(app.getHttpServer()).get('/v1/auth/session');
    expect(none.status).toBe(401);
    expect(none.body.code).toBe('UNAUTHENTICATED');

    const bogus = await request(app.getHttpServer())
      .get('/v1/auth/session')
      .set('Cookie', 'shr_session=forged-token-value');
    expect(bogus.status).toBe(401);
    expect(bogus.body.code).toBe('SESSION_EXPIRED');
  });

  it('logs out: the old cookie stops working', async () => {
    const user = await member('logout');
    const browser = new Browser(app);
    await browser.login(user.email);
    const token = browser.session!;
    expect((await browser.send('post', '/v1/auth/logout')).status).toBe(204);

    const after = await request(app.getHttpServer())
      .get('/v1/auth/session')
      .set('Cookie', `shr_session=${token}`);
    expect(after.status).toBe(401);
  });

  it('ends every session with sign-out everywhere', async () => {
    const user = await member('logoutall');
    const laptop = new Browser(app);
    const phone = new Browser(app);
    await laptop.login(user.email);
    await phone.login(user.email);

    expect((await laptop.send('post', '/v1/auth/logout-all')).status).toBe(204);
    expect((await phone.get('/v1/auth/session')).status).toBe(401);
    expect((await laptop.get('/v1/auth/session')).status).toBe(401);
  });

  it('expires after the idle timeout and after the absolute lifetime', async () => {
    const user = await member('expiry');
    const idle = new Browser(app);
    await idle.login(user.email);
    await owner.userSession.update({
      where: { tokenHash: hashToken(idle.session!) },
      data: { idleExpiresAt: new Date(Date.now() - 1000) },
    });
    expect((await idle.get('/v1/auth/session')).body.code).toBe('SESSION_EXPIRED');

    const absolute = new Browser(app);
    await absolute.login(user.email);
    await owner.userSession.update({
      where: { tokenHash: hashToken(absolute.session!) },
      data: { absoluteExpiresAt: new Date(Date.now() - 1000) },
    });
    expect((await absolute.get('/v1/auth/session')).status).toBe(401);
  });

  it('cuts off a user the moment their account is disabled', async () => {
    const user = await member('cutoff');
    const browser = new Browser(app);
    await browser.login(user.email);
    expect((await browser.get('/v1/auth/session')).status).toBe(200);
    await owner.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
    expect((await browser.get('/v1/auth/session')).status).toBe(401);
  });

  it('lists the user’s own sessions and revokes one', async () => {
    const user = await member('listsessions');
    const laptop = new Browser(app);
    const phone = new Browser(app);
    await laptop.login(user.email);
    await phone.login(user.email);

    const list = await laptop.get('/v1/auth/sessions');
    expect(list.body).toHaveLength(2);
    const other = (list.body as { id: string; current: boolean }[]).find((s) => !s.current)!;
    expect((await laptop.send('delete', `/v1/auth/sessions/${other.id}`)).status).toBe(204);
    expect((await phone.get('/v1/auth/session')).status).toBe(401);
    expect((await laptop.get('/v1/auth/session')).status).toBe(200);
  });

  it('cannot revoke someone else’s session (looks like it does not exist)', async () => {
    const alice = await member('alice-idor');
    const bob = await member('bob-idor');
    const aliceBrowser = new Browser(app);
    const bobBrowser = new Browser(app);
    await aliceBrowser.login(alice.email);
    await bobBrowser.login(bob.email);
    const bobSession = await owner.userSession.findFirstOrThrow({
      where: { tokenHash: hashToken(bobBrowser.session!) },
    });

    const res = await aliceBrowser.send('delete', `/v1/auth/sessions/${bobSession.id}`);
    expect(res.status).toBe(404);
    expect((await bobBrowser.get('/v1/auth/session')).status).toBe(200);
  });
});

describe('cross-site request protection', () => {
  it('requires the CSRF token on state-changing requests', async () => {
    const user = await member('csrf');
    const browser = new Browser(app);
    await browser.login(user.email);

    const missing = await browser.agent.post('/v1/auth/logout').set('Origin', WEB_ORIGIN);
    expect(missing.status).toBe(403);
    expect(missing.body.code).toBe('CSRF_INVALID');

    const wrong = await browser.agent
      .post('/v1/auth/logout')
      .set('Origin', WEB_ORIGIN)
      .set('x-csrf-token', 'guess');
    expect(wrong.status).toBe(403);

    // Still signed in: the forged requests changed nothing.
    expect((await browser.get('/v1/auth/session')).status).toBe(200);
  });

  it('rejects state-changing requests from other origins, including sign-in', async () => {
    const user = await member('origin');
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: user.email, password: DEFAULT_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('rotates the CSRF token whenever the session token rotates', async () => {
    const user = await member('rotate');
    const browser = new Browser(app);
    await browser.login(user.email);
    const before = browser.csrf;
    await browser.send('post', '/v1/auth/password/change', {
      currentPassword: DEFAULT_PASSWORD,
      newPassword: 'amber meadow lantern 77',
    });
    expect(browser.csrf).not.toBe(before);
  });
});

describe('password reset', () => {
  it('answers identically whether or not the account exists, and emails only real accounts', async () => {
    const user = await member('forgot');
    const known = await new Browser(app).send('post', '/v1/auth/password/forgot', { email: user.email });
    const unknown = await new Browser(app).send('post', '/v1/auth/password/forgot', {
      email: `ghost-${fx.run}@test.local`,
    });

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    expect(await queuedEmails(env, user.email)).toHaveLength(1);
    expect(await queuedEmails(env, `ghost-${fx.run}@test.local`)).toHaveLength(0);
  });

  it('resets with a single-use link and signs out every session', async () => {
    const user = await member('reset');
    const existing = new Browser(app);
    await existing.login(user.email);

    await new Browser(app).send('post', '/v1/auth/password/forgot', { email: user.email });
    const [email] = await queuedEmails(env, user.email);
    const token = resetTokenFrom(email!);
    expect(email!.text).toContain(`${env.APP_PUBLIC_URL}/reset-password?token=`);

    // Only the hash is stored.
    expect(await owner.passwordResetToken.count({ where: { tokenHash: token } })).toBe(0);

    const newPassword = 'cobalt orchard whisper 19';
    const reset = await new Browser(app).send('post', '/v1/auth/password/reset', { token, newPassword });
    expect(reset.status).toBe(204);

    expect((await existing.get('/v1/auth/session')).status).toBe(401);
    expect((await new Browser(app).login(user.email)).status).toBe(401);
    expect((await new Browser(app).login(user.email, newPassword)).status).toBe(200);

    const again = await new Browser(app).send('post', '/v1/auth/password/reset', {
      token,
      newPassword: 'another fine passphrase',
    });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('RESET_TOKEN_INVALID');
  });

  it('rejects an expired link', async () => {
    const user = await member('expired-reset');
    await new Browser(app).send('post', '/v1/auth/password/forgot', { email: user.email });
    const token = resetTokenFrom((await queuedEmails(env, user.email))[0]!);
    await owner.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await new Browser(app).send('post', '/v1/auth/password/reset', {
      token,
      newPassword: 'cobalt orchard whisper 19',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RESET_TOKEN_INVALID');
  });

  it('invalidates an older link when a new one is requested', async () => {
    const user = await member('two-links');
    await new Browser(app).send('post', '/v1/auth/password/forgot', { email: user.email });
    await new Browser(app).send('post', '/v1/auth/password/forgot', { email: user.email });
    const [first, second] = (await queuedEmails(env, user.email)).map(resetTokenFrom);
    const tokens = [first!, second!];
    const results = await Promise.all(
      tokens.map(
        async (token) =>
          (
            await new Browser(app).send('post', '/v1/auth/password/reset', {
              token,
              newPassword: 'quartz river evening 64',
            })
          ).status,
      ),
    );
    expect(results.sort()).toEqual([204, 400]);
  });

  it('enforces the password policy without burning the link', async () => {
    const user = await member('weak');
    await new Browser(app).send('post', '/v1/auth/password/forgot', { email: user.email });
    const token = resetTokenFrom((await queuedEmails(env, user.email))[0]!);

    const weak = await new Browser(app).send('post', '/v1/auth/password/reset', {
      token,
      newPassword: 'Password@123',
    });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('WEAK_PASSWORD');

    const strong = await new Browser(app).send('post', '/v1/auth/password/reset', {
      token,
      newPassword: 'saffron glacier pencil 3',
    });
    expect(strong.status).toBe(204);
  });
});

describe('change password', () => {
  it('requires the current password', async () => {
    const user = await member('change-wrong');
    const browser = new Browser(app);
    await browser.login(user.email);
    const res = await browser.send('post', '/v1/auth/password/change', {
      currentPassword: 'not my password!!',
      newPassword: 'amber meadow lantern 77',
    });
    expect(res.status).toBe(401);
  });

  it('keeps this session but signs out the others', async () => {
    const user = await member('change');
    const here = new Browser(app);
    const elsewhere = new Browser(app);
    await here.login(user.email);
    await elsewhere.login(user.email);

    const res = await here.send('post', '/v1/auth/password/change', {
      currentPassword: DEFAULT_PASSWORD,
      newPassword: 'amber meadow lantern 77',
    });
    expect(res.status).toBe(204);
    expect((await here.get('/v1/auth/session')).status).toBe(200);
    expect((await elsewhere.get('/v1/auth/session')).status).toBe(401);
  });
});

describe('two-step verification (TOTP)', () => {
  async function enrol(email: string, userId: string) {
    const browser = new Browser(app);
    await browser.login(email);
    const setup = await browser.send('post', '/v1/auth/mfa/totp/setup');
    expect(setup.status).toBe(200);
    const secret = setup.body.secret as string;
    const confirm = await browser.send('post', '/v1/auth/mfa/totp/confirm', {
      code: generateTotpForTesting(secret),
    });
    expect(confirm.status).toBe(200);
    const stored = await owner.user.findUniqueOrThrow({ where: { id: userId } });
    return { browser, secret, recoveryCodes: confirm.body.recoveryCodes as string[], stored };
  }

  it('enrols, stores the secret encrypted, and returns ten recovery codes', async () => {
    const user = await member('mfa-enrol');
    const { secret, recoveryCodes, stored } = await enrol(user.email, user.id);
    expect(recoveryCodes).toHaveLength(10);
    expect(stored.mfaEnabledAt).not.toBeNull();
    expect(stored.mfaTotpSecret).not.toContain(secret);
    expect(decryptTotpSecret(stored.mfaTotpSecret!, user.id)).toBe(secret);
    const codes = await owner.mfaRecoveryCode.findMany({ where: { userId: user.id } });
    expect(codes.map((c) => c.codeHash)).not.toContain(recoveryCodes[0]);
  });

  it('requires a recent password confirmation to start enrolment', async () => {
    const user = await member('mfa-reauth');
    const browser = new Browser(app);
    await browser.login(user.email);
    await owner.userSession.update({
      where: { tokenHash: hashToken(browser.session!) },
      data: { reauthenticatedAt: null },
    });

    const denied = await browser.send('post', '/v1/auth/mfa/totp/setup');
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('REAUTH_REQUIRED');

    expect(
      (await browser.send('post', '/v1/auth/reauthenticate', { password: 'wrong password!!' })).status,
    ).toBe(401);
    expect(
      (await browser.send('post', '/v1/auth/reauthenticate', { password: DEFAULT_PASSWORD })).status,
    ).toBe(204);
    expect((await browser.send('post', '/v1/auth/mfa/totp/setup')).status).toBe(200);
  });

  it('holds a signed-in session at the second factor until a valid code is given', async () => {
    const user = await member('mfa-login');
    const { secret, stored } = await enrol(user.email, user.id);
    // Enrolment consumed the current time step; pretend it happened one step earlier so a fresh code is usable now.
    await owner.user.update({
      where: { id: user.id },
      data: { mfaTotpLastStep: stored.mfaTotpLastStep! - 1n },
    });

    const browser = new Browser(app);
    const login = await browser.login(user.email);
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ mfaPending: true, activeTenant: null, memberships: [] });
    const pendingToken = browser.session!;

    const blocked = await browser.get('/v1/tenant/settings');
    expect(blocked.status).toBe(401);
    expect(blocked.body.code).toBe('MFA_REQUIRED');

    expect((await browser.send('post', '/v1/auth/mfa/verify', { code: '000000' })).status).toBe(401);

    const verified = await browser.send('post', '/v1/auth/mfa/verify', {
      code: generateTotpForTesting(secret),
    });
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({ mfaPending: false, activeTenant: { id: tenantId } });
    expect(browser.session).not.toBe(pendingToken);
    expect((await browser.get('/v1/tenant/settings')).status).toBe(200);

    // The pre-verification token is dead.
    const old = await request(app.getHttpServer())
      .get('/v1/auth/session')
      .set('Cookie', `shr_session=${pendingToken}`);
    expect(old.status).toBe(401);
  });

  it('rejects a code that was already used', async () => {
    const user = await member('mfa-replay');
    const { secret, stored } = await enrol(user.email, user.id);
    // The enrolment code's step is now the last used step: generating for it reproduces a used code.
    const usedCode = generateTotpForTesting(secret, Number(stored.mfaTotpLastStep) * 30_000);

    const browser = new Browser(app);
    await browser.login(user.email);
    const res = await browser.send('post', '/v1/auth/mfa/verify', { code: usedCode });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CODE');
  });

  it('accepts each recovery code once', async () => {
    const user = await member('mfa-recovery');
    const { recoveryCodes } = await enrol(user.email, user.id);

    const first = new Browser(app);
    await first.login(user.email);
    const ok = await first.send('post', '/v1/auth/mfa/verify', {
      recoveryCode: recoveryCodes[0]!.toLowerCase(),
    });
    expect(ok.status).toBe(200);
    expect(ok.body.mfaPending).toBe(false);

    const second = new Browser(app);
    await second.login(user.email);
    expect(
      (await second.send('post', '/v1/auth/mfa/verify', { recoveryCode: recoveryCodes[0]! })).status,
    ).toBe(401);
  });

  it('turns off only after a recent confirmation, and records it', async () => {
    const user = await member('mfa-disable');
    const { browser } = await enrol(user.email, user.id);
    expect((await browser.send('delete', '/v1/auth/mfa/totp')).status).toBe(204);

    const after = await owner.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.mfaEnabledAt).toBeNull();
    expect(after.mfaTotpSecret).toBeNull();
    expect(await owner.mfaRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
    expect(
      await owner.auditEvent.count({ where: { actorUserId: user.id, action: 'auth.mfa.disable' } }),
    ).toBe(1);
  });
});

describe('security audit trail', () => {
  it('records sign-in events without passwords, tokens or codes', async () => {
    const secretPassword = 'unique audit passphrase 8812';
    const user = await fx.user('audit', { password: secretPassword });
    await fx.member(tenantId, user.id);

    const browser = new Browser(app);
    await browser.login(user.email, 'wrong but distinctive pw 4471');
    await browser.login(user.email, secretPassword);
    await browser.send('post', '/v1/auth/password/forgot', { email: user.email });
    const resetToken = resetTokenFrom((await queuedEmails(env, user.email))[0]!);

    const events = await owner.auditEvent.findMany({
      where: { actorUserId: user.id },
      orderBy: { occurredAt: 'asc' },
    });
    expect(events.map((e) => `${e.action}:${e.outcome}`)).toEqual([
      'auth.login:FAILURE',
      'auth.login:SUCCESS',
      'auth.password.reset_requested:SUCCESS',
    ]);
    const serialized = JSON.stringify(events);
    for (const secret of [
      secretPassword,
      'wrong but distinctive pw 4471',
      resetToken,
      browser.session!,
      browser.csrf!,
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(events[0]!.ipAddress).toBeTruthy();
  });

  it('shows the user their own recent security activity', async () => {
    const user = await member('history');
    const browser = new Browser(app);
    await browser.login(user.email);
    const res = await browser.get('/v1/auth/security-events');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ action: 'auth.login', outcome: 'SUCCESS' });
  });
});
