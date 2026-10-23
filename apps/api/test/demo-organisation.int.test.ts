/**
 * The demo organisation a platform operator can create to check the product: it is on the Launch plan with
 * every feature, and the sign-in it returns really works and opens the full menu's worth of access.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_FEATURES } from '@smart-hr/entitlements';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import { Browser, DEFAULT_PASSWORD, Fixtures, ownerClient, startApp, testEnv } from './helpers.js';

let app: NestExpressApplication;
const db = ownerClient();
const fx = new Fixtures(db);
let operator: Browser;

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  const admin = await fx.user('demo-operator', { platformAdmin: true });
  operator = new Browser(app);
  expect((await operator.login(admin.email)).status).toBe(200);
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await db.$disconnect();
});

describe('demo organisation', () => {
  it('is created on the Launch plan and its returned sign-in works', async () => {
    const res = await operator.send('post', '/v1/platform/demo-organisation');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { id, email, password } = res.body as { id: string; email: string; password: string };

    const sub = await db.subscription.findFirstOrThrow({
      where: { tenantId: id },
      include: { planVersion: { include: { plan: true } } },
    });
    expect(sub.planVersion.plan.code).toBe('LAUNCH');
    expect(sub.status).toBe('ACTIVE');
    expect(sub.planVersion.features.length).toBe(ALL_FEATURES.length);

    const owner = new Browser(app);
    expect((await owner.login(email, password)).status).toBe(200);
    const session = await owner.get('/v1/auth/session');
    expect(session.status).toBe(200);
    expect(session.body.activeTenant.isTenantAdmin).toBe(true);
    expect(session.body.activeTenant.plan.features).toHaveLength(ALL_FEATURES.length);

    // Clean up through the real delete path, which also tests removing a demo.
    await db.userSession.updateMany({
      where: { user: { isPlatformAdmin: true } },
      data: { reauthenticatedAt: null },
    });
    expect(
      (await operator.send('post', '/v1/auth/reauthenticate', { password: DEFAULT_PASSWORD })).status,
    ).toBe(204);
    const del = await operator.send('post', `/v1/platform/tenants/${id}/delete`, {
      confirmSlug: res.body.slug,
      reason: 'Test demo',
      deleteAccounts: true,
    });
    expect(del.status, JSON.stringify(del.body)).toBe(200);
  });

  it('is refused for people who are not platform operators', async () => {
    const u = await fx.user('demo-nobody');
    const b = new Browser(app);
    await b.login(u.email);
    expect((await b.send('post', '/v1/platform/demo-organisation')).status).toBe(403);
  });
});
