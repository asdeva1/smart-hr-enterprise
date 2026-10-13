/**
 * Tenant-aware authorization through the real API: the active tenant comes only from the verified session,
 * and Tenant A can never read or write Tenant B's data, whatever the client sends.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { DatabaseClient } from '@smart-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Browser, Fixtures, ownerClient, startApp, testEnv } from './helpers.js';

let app: NestExpressApplication;
let owner: DatabaseClient;
let fx: Fixtures;
let tenantA: string;
let tenantB: string;
let settingInB: string;

beforeAll(async () => {
  app = await startApp(testEnv());
  owner = ownerClient();
  fx = new Fixtures(owner);
  tenantA = (await fx.tenant('Alpha')).id;
  tenantB = (await fx.tenant('Beta')).id;
  await owner.tenantSetting.create({ data: { tenantId: tenantA, key: 'timezone', value: 'Asia/Kolkata' } });
  settingInB = (
    await owner.tenantSetting.create({ data: { tenantId: tenantB, key: 'timezone', value: 'Asia/Dubai' } })
  ).id;
});

afterAll(async () => {
  await fx?.cleanup();
  await owner?.$disconnect();
  await app?.close();
});

async function signedIn(memberships: { tenantId: string; admin?: boolean }[]) {
  const user = await fx.user('tenancy');
  for (const m of memberships) await fx.member(m.tenantId, user.id, m.admin ?? false);
  const browser = new Browser(app);
  const res = await browser.login(user.email);
  expect(res.status).toBe(200);
  return {
    user,
    browser,
    view: res.body as { activeTenant: { id: string } | null; memberships: { tenantId: string }[] },
  };
}

/** Setting values from a settings-list response body. */
function values(body: unknown): unknown[] {
  return (body as { value: unknown }[]).map((s) => s.value);
}

describe('active tenant', () => {
  it('is chosen automatically for a single membership', async () => {
    const { view } = await signedIn([{ tenantId: tenantA }]);
    expect(view.activeTenant?.id).toBe(tenantA);
  });

  it('must be chosen explicitly with several memberships', async () => {
    const { browser, view } = await signedIn([{ tenantId: tenantA }, { tenantId: tenantB }]);
    expect(view.activeTenant).toBeNull();
    expect(view.memberships.map((m) => m.tenantId).sort()).toEqual([tenantA, tenantB].sort());

    const before = await browser.get('/v1/tenant/settings');
    expect(before.status).toBe(403);
    expect(before.body.code).toBe('TENANT_REQUIRED');

    const switched = await browser.send('post', '/v1/auth/tenant', { tenantId: tenantB });
    expect(switched.status).toBe(200);
    const settings = await browser.get('/v1/tenant/settings');
    expect(values(settings.body)).toEqual(['Asia/Dubai']);
  });

  it('cannot be switched to a tenant the user does not belong to', async () => {
    const { user, browser } = await signedIn([{ tenantId: tenantA }]);
    const res = await browser.send('post', '/v1/auth/tenant', { tenantId: tenantB });
    expect(res.status).toBe(403);
    expect(
      await owner.auditEvent.count({
        where: { actorUserId: user.id, action: 'auth.tenant.switch', outcome: 'DENIED' },
      }),
    ).toBe(1);
    // Still in A.
    expect(values((await browser.get('/v1/tenant/settings')).body)).toEqual(['Asia/Kolkata']);
  });

  it('ignores tenant ids supplied in headers, query strings or bodies', async () => {
    const { browser } = await signedIn([{ tenantId: tenantA, admin: true }]);
    const viaQuery = await browser.agent
      .get(`/v1/tenant/settings?tenantId=${tenantB}`)
      .set('x-tenant-id', tenantB);
    expect(values(viaQuery.body)).toEqual(['Asia/Kolkata']);

    const write = await browser.send(
      'put',
      '/v1/tenant/settings/week_start',
      { value: 'MONDAY', tenantId: tenantB },
      { 'x-tenant-id': tenantB },
    );
    expect(write.status).toBe(200);
    const stored = await owner.tenantSetting.findFirstOrThrow({ where: { id: write.body.id } });
    expect(stored.tenantId).toBe(tenantA);
    expect(await owner.tenantSetting.count({ where: { tenantId: tenantB, key: 'week_start' } })).toBe(0);
  });
});

describe('cross-tenant record access (IDOR)', () => {
  it('answers 404 for another tenant’s record id, exactly as for a missing one', async () => {
    const { browser } = await signedIn([{ tenantId: tenantA }]);
    const other = await browser.get(`/v1/tenant/settings/${settingInB}`);
    const missing = await browser.get('/v1/tenant/settings/01890000-0000-7000-8000-000000000000');
    expect(other.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(other.body.code).toBe(missing.body.code);
  });

  it('rejects malformed ids before they reach the database', async () => {
    const { browser } = await signedIn([{ tenantId: tenantA }]);
    expect((await browser.get("/v1/tenant/settings/1' OR '1'='1")).status).toBe(400);
  });
});

describe('permissions', () => {
  it('lets only organisation admins change settings', async () => {
    const { browser: member } = await signedIn([{ tenantId: tenantA }]);
    const denied = await member.send('put', '/v1/tenant/settings/locale', { value: 'en-IN' });
    expect(denied.status).toBe(403);

    const { browser: admin } = await signedIn([{ tenantId: tenantA, admin: true }]);
    expect((await admin.send('put', '/v1/tenant/settings/locale', { value: 'en-IN' })).status).toBe(200);
  });

  it('records setting changes in the tenant’s audit trail', async () => {
    const { user, browser } = await signedIn([{ tenantId: tenantA, admin: true }]);
    await browser.send('put', '/v1/tenant/settings/currency', { value: 'INR' });
    const event = await owner.auditEvent.findFirstOrThrow({
      where: { actorUserId: user.id, action: 'tenant.setting.update' },
    });
    expect(event.tenantId).toBe(tenantA);
    expect(event.metadata).toEqual({ key: 'currency' });
  });

  it('withdraws access immediately when a membership is suspended', async () => {
    const { user, browser } = await signedIn([{ tenantId: tenantA }]);
    expect((await browser.get('/v1/tenant/settings')).status).toBe(200);
    await owner.tenantMembership.updateMany({ where: { userId: user.id }, data: { status: 'SUSPENDED' } });
    expect((await browser.get('/v1/tenant/settings')).status).toBe(403);
  });

  it('withdraws access when the tenant itself is suspended', async () => {
    const suspended = await fx.tenant('Gamma');
    const { browser } = await signedIn([{ tenantId: suspended.id }]);
    expect((await browser.get('/v1/tenant/settings')).status).toBe(200);
    await owner.tenant.update({ where: { id: suspended.id }, data: { status: 'SUSPENDED' } });
    expect((await browser.get('/v1/tenant/settings')).status).toBe(403);
  });
});
