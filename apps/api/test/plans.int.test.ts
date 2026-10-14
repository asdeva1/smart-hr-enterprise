/**
 * Plans, subscriptions and entitlements through the real API and database: the platform console, backend
 * feature gating, read-only expiry, limits (including under concurrency) and the database rules underneath.
 */
import { Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDatabaseClient, withContext } from '@smart-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequireFeature } from '../src/auth/auth.decorators.js';
import type { ApiEnv } from '../src/config/env.js';
import { Browser, Fixtures, ownerClient, requireEnv, startApp, testEnv } from './helpers.js';

/** A stand-in for a gated module (payroll ships in Phase 14), so gating is tested through the real guard. */
@Controller('test/payroll')
class PayrollProbeController {
  @Get()
  @RequireFeature('payroll')
  read() {
    return { ok: true };
  }

  @Post()
  @HttpCode(201)
  @RequireFeature('payroll')
  write() {
    return { ok: true };
  }
}

@Module({ controllers: [PayrollProbeController] })
class ProbeModule {}

let env: ApiEnv;
let app: NestExpressApplication;
const db = ownerClient();
const runtime = createDatabaseClient({ connectionString: requireEnv('DATABASE_URL'), maxConnections: 4 });
const fx = new Fixtures(db);
let operator: Browser;

beforeAll(async () => {
  env = testEnv();
  app = await startApp(env, [ProbeModule]);
  const admin = await fx.user('operator', { platformAdmin: true });
  operator = new Browser(app);
  expect((await operator.login(admin.email)).status).toBe(200);
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await runtime.$disconnect();
  await db.$disconnect();
});

async function organisation(name: string, plan: string | null) {
  const tenant = await fx.tenant(name, 'ACTIVE', { plan });
  const ownerUser = await fx.user(`${name}-owner`);
  await fx.member(tenant.id, ownerUser.id, true);
  const owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  return { tenant, owner };
}

const DAY = 86_400_000;
const days = (n: number) => new Date(Date.now() + n * DAY);

describe('feature gating in the backend', () => {
  it('refuses a feature the plan does not include, for reads and writes', async () => {
    const org = await organisation('Lite', 'LITE');
    const read = await org.owner.get('/test/payroll');
    expect(read.status).toBe(403);
    expect(read.body.code).toBe('ENTITLEMENT_REQUIRED');
    expect((await org.owner.send('post', '/test/payroll')).status).toBe(403);
  });

  it('allows a feature the plan includes', async () => {
    const org = await organisation('Premium', 'PREMIUM');
    expect((await org.owner.get('/test/payroll')).status).toBe(200);
    expect((await org.owner.send('post', '/test/payroll')).status).toBe(201);
  });

  it('gives an organisation with no subscription nothing gated, but keeps the foundation working', async () => {
    const org = await organisation('NoPlan', null);
    expect((await org.owner.get('/test/payroll')).body.code).toBe('ENTITLEMENT_REQUIRED');
    expect((await org.owner.get('/v1/org/companies')).status).toBe(200);
  });

  it('makes an expired or suspended organisation read-only, never locked out of its data', async () => {
    for (const status of ['EXPIRED', 'SUSPENDED'] as const) {
      const org = await organisation(`Lapsed${status}`, null);
      await fx.subscribe(org.tenant.id, 'PREMIUM', { status });
      expect((await org.owner.get('/test/payroll')).status).toBe(200);
      const write = await org.owner.send('post', '/test/payroll');
      expect(write.status).toBe(403);
      expect(write.body.code).toBe('SUBSCRIPTION_READ_ONLY');
    }
  });

  it('keeps full access through the grace period after a trial ends, then turns read-only', async () => {
    const org = await organisation('Trial', null);
    await fx.subscribe(org.tenant.id, 'PREMIUM', { status: 'TRIAL', trialEndsAt: days(-1) });
    expect((await org.owner.send('post', '/test/payroll')).status).toBe(201);
    // PREMIUM's grace is 30 days.
    await fx.subscribe(org.tenant.id, 'PREMIUM', { status: 'TRIAL', trialEndsAt: days(-31) });
    expect((await org.owner.send('post', '/test/payroll')).body.code).toBe('SUBSCRIPTION_READ_ONLY');
  });

  it('applies a platform override immediately, and its revocation', async () => {
    const org = await organisation('Override', 'LITE');
    const grant = await operator.send('post', `/v1/platform/tenants/${org.tenant.id}/overrides`, {
      kind: 'FEATURE',
      key: 'payroll',
      enabled: true,
      reason: 'Pilot customer',
    });
    expect(grant.status).toBe(201);
    expect((await org.owner.get('/test/payroll')).status).toBe(200);

    const revoke = await operator.send(
      'post',
      `/v1/platform/tenants/${org.tenant.id}/overrides/${grant.body.id}/revoke`,
    );
    expect(revoke.status).toBe(200);
    expect((await org.owner.get('/test/payroll')).status).toBe(403);
  });

  it('tells the browser what the plan includes, for showing and hiding UI', async () => {
    const org = await organisation('Session', 'PRO');
    const session = await org.owner.get('/v1/auth/session');
    expect(session.body.activeTenant.plan).toMatchObject({ code: 'PRO', status: 'ACTIVE', access: 'FULL' });
    expect(session.body.activeTenant.plan.features).toContain('recruitment');
    expect(session.body.activeTenant.plan.features).not.toContain('payroll');
  });
});

describe('limits', () => {
  it('refuses a second company on a one-company plan', async () => {
    const org = await organisation('OneCo', 'LITE');
    const company = (code: string) => ({
      code,
      name: code,
      country: 'IN',
      baseCurrency: 'INR',
      timezone: 'Asia/Kolkata',
    });
    expect((await org.owner.send('post', '/v1/org/companies', company(`A${fx.run}`))).status).toBe(201);
    const second = await org.owner.send('post', '/v1/org/companies', company(`B${fx.run}`));
    expect(second.status).toBe(403);
    expect(second.body.code).toBe('LIMIT_REACHED');
  });

  it('admits exactly one of many concurrent invitations when one place is left', async () => {
    const org = await organisation('Seats', 'LITE');
    // One member (the owner) so far; allow two.
    const set = await operator.send('post', `/v1/platform/tenants/${org.tenant.id}/overrides`, {
      kind: 'LIMIT',
      key: 'users.max',
      value: 2,
      reason: 'Concurrency test',
    });
    expect(set.status).toBe(201);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        org.owner.send('post', '/v1/admin/members', {
          email: `seat-${i}-${fx.run}@test.local`,
          displayName: `Seat ${i}`,
          assignments: [],
        }),
      ),
    );
    for (const r of results) {
      const email = (r.request as unknown as { _data?: { email?: string } })._data?.email;
      if (r.status === 201 && email) {
        const user = await db.user.findUnique({ where: { email } });
        if (user) fx.trackUser(user.id);
      }
    }
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.body.code === 'LIMIT_REACHED')).toHaveLength(5);
  });

  it('shows usage against limits to administrators', async () => {
    const org = await organisation('Usage', 'PRO');
    const plan = await org.owner.get('/v1/tenant/plan');
    expect(plan.status).toBe(200);
    const users = (plan.body as { limits: { code: string }[] }).limits.find((l) => l.code === 'users.max');
    expect(users).toMatchObject({ limit: 300, used: 1 });
  });
});

describe('platform console', () => {
  it('is closed to everyone but platform administrators', async () => {
    const org = await organisation('Closed', 'ENTERPRISE');
    expect((await org.owner.get('/v1/platform/plans')).status).toBe(403);
    expect((await org.owner.get('/v1/platform/tenants')).status).toBe(403);
    expect(
      (await org.owner.send('put', `/v1/platform/tenants/${org.tenant.id}/subscription`, {})).status,
    ).toBe(403);
  });

  it('creates, prices and publishes a plan, then freezes it', async () => {
    const created = await operator.send('post', '/v1/platform/plans', {
      code: `T${fx.run}`.toUpperCase(),
      name: 'Test plan',
    });
    expect(created.status).toBe(201);
    const plan = await operator.get(`/v1/platform/plans/${created.body.id}`);
    const draft = plan.body.versions[0];
    expect(draft.status).toBe('DRAFT');

    const edit = await operator.send('patch', `/v1/platform/plan-versions/${draft.id}`, {
      features: ['hr.core', 'payroll'],
      limits: { 'employees.max': 50, 'storage.gb': null },
      prices: [{ currency: 'INR', billingPeriod: 'MONTHLY', pricingModel: 'PER_EMPLOYEE', amount: '149.50' }],
    });
    expect(edit.status).toBe(200);
    expect(edit.body.prices[0].amount).toBe('149.5');

    const bad = await operator.send('patch', `/v1/platform/plan-versions/${draft.id}`, {
      features: ['not.a.feature'],
    });
    expect(bad.status).toBe(400);

    expect((await operator.send('post', `/v1/platform/plan-versions/${draft.id}/publish`)).status).toBe(200);
    const frozen = await operator.send('patch', `/v1/platform/plan-versions/${draft.id}`, { trialDays: 7 });
    expect(frozen.status).toBe(409);

    const next = await operator.send('post', `/v1/platform/plans/${created.body.id}/versions`);
    expect(next.status).toBe(201);
    expect(next.body).toMatchObject({ version: 2, status: 'DRAFT', features: ['hr.core', 'payroll'] });
    expect(next.body.prices).toHaveLength(1);
    expect((await operator.send('post', `/v1/platform/plans/${created.body.id}/versions`)).body.code).toBe(
      'DRAFT_EXISTS',
    );
    expect((await operator.send('delete', `/v1/platform/plan-versions/${next.body.id}`)).status).toBe(204);
  });

  it('runs a subscription through trial, plan change, renewal and cancellation, keeping history', async () => {
    const org = await organisation('Lifecycle', null);
    const plans = (await operator.get('/v1/platform/plans')).body as {
      code: string;
      versions: { id: string; status: string }[];
    }[];
    const version = (code: string) =>
      plans.find((p) => p.code === code)!.versions.find((v) => v.status === 'PUBLISHED')!.id;
    const base = `/v1/platform/tenants/${org.tenant.id}/subscription`;

    const trial = await operator.send('put', base, { planVersionId: version('PRO'), status: 'TRIAL' });
    expect(trial.status).toBe(200);
    expect(trial.body.status).toBe('TRIAL');
    expect(new Date(String(trial.body.trialEndsAt)).getTime()).toBeGreaterThan(Date.now() + 13 * DAY);

    // Enterprise has no trial unless the operator sets one.
    const noTrial = await operator.send('put', base, {
      planVersionId: version('ENTERPRISE'),
      status: 'TRIAL',
    });
    expect(noTrial.body.code).toBe('NO_TRIAL');

    const upgrade = await operator.send('put', base, {
      planVersionId: version('PREMIUM'),
      status: 'ACTIVE',
      currentPeriodEnd: days(30).toISOString(),
    });
    expect(upgrade.body.status).toBe('ACTIVE');
    expect((await org.owner.get('/test/payroll')).status).toBe(200);

    const renew = await operator.send('post', `${base}/actions`, {
      action: 'renew',
      currentPeriodEnd: days(395).toISOString(),
    });
    expect(renew.status).toBe(200);
    expect(new Date(String(renew.body.currentPeriodStart)).getTime()).toBeGreaterThan(Date.now() + 29 * DAY);

    const cancel = await operator.send('post', `${base}/actions`, { action: 'cancel' });
    expect(cancel.body.status).toBe('CANCELLED');
    // Access continues to the end of the paid period.
    expect((await org.owner.send('post', '/test/payroll')).status).toBe(201);

    const detail = await operator.get(base);
    expect((detail.body as { events: { action: string }[] }).events.map((e) => e.action)).toEqual([
      'cancel',
      'renew',
      'change_plan',
      'start',
    ]);
    const audit = await org.owner.get('/v1/admin/audit?limit=50');
    const body = audit.body as { items?: { action: string }[] } | { action: string }[];
    const actions = (Array.isArray(body) ? body : (body.items ?? [])).map((e) => e.action);
    expect(actions).toContain('platform.subscription.cancel');
  });

  it('refuses to assign a draft or retired version', async () => {
    const org = await organisation('Draft', null);
    const created = await operator.send('post', '/v1/platform/plans', {
      code: `D${fx.run}`.toUpperCase(),
      name: 'Draft plan',
    });
    const draftId = (await operator.get(`/v1/platform/plans/${created.body.id}`)).body.versions[0].id;
    const res = await operator.send('put', `/v1/platform/tenants/${org.tenant.id}/subscription`, {
      planVersionId: draftId,
      status: 'ACTIVE',
    });
    expect(res.body.code).toBe('VERSION_NOT_FOR_SALE');
  });
});

describe('database rules', () => {
  it('refuses to change a published plan version, even for the platform', async () => {
    const version = await db.planVersion.findFirstOrThrow({ where: { status: 'PUBLISHED' } });
    await expect(
      withContext(runtime, { userId: version.id, platformActor: true }, (tx) =>
        tx.planVersion.update({ where: { id: version.id }, data: { trialDays: version.trialDays + 1 } }),
      ),
    ).rejects.toThrow(/cannot be changed/);
    await expect(
      withContext(runtime, { userId: version.id, platformActor: true }, (tx) =>
        tx.planPrice.create({
          data: {
            planVersionId: version.id,
            currency: 'USD',
            billingPeriod: 'ANNUAL',
            pricingModel: 'FLAT',
            amount: '1',
          },
        }),
      ),
    ).rejects.toThrow(/cannot be changed/);
  });

  it('never lets an organisation change its own subscription, even with its own tenant context', async () => {
    const org = await organisation('SelfServe', 'LITE');
    const premium = await db.planVersion.findFirstOrThrow({
      where: { plan: { code: 'PREMIUM' }, status: 'PUBLISHED' },
    });
    const changed = await withContext(runtime, { tenantId: org.tenant.id }, (tx) =>
      tx.subscription.updateMany({ data: { planVersionId: premium.id } }),
    );
    expect(changed.count).toBe(0);
    await expect(
      withContext(runtime, { tenantId: org.tenant.id }, (tx) =>
        tx.entitlementOverride.create({
          data: { tenantId: org.tenant.id, kind: 'FEATURE', key: 'payroll', enabled: true, reason: 'self' },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('keeps subscriptions isolated between organisations', async () => {
    const a = await organisation('IsoA', 'LITE');
    const b = await organisation('IsoB', 'PREMIUM');
    const seen = await withContext(runtime, { tenantId: a.tenant.id }, (tx) => tx.subscription.findMany());
    expect(seen.map((s) => s.tenantId)).toEqual([a.tenant.id]);
    const cross = await withContext(runtime, { tenantId: a.tenant.id, platformActor: true }, (tx) =>
      tx.subscription.updateMany({ where: { tenantId: b.tenant.id }, data: { status: 'SUSPENDED' } }),
    );
    expect(cross.count).toBe(0);
  });

  it('scopes even a platform transaction to one organisation once a tenant is set', async () => {
    const a = await organisation('ScopeA', 'LITE');
    await organisation('ScopeB', 'PREMIUM');
    const scoped = await withContext(runtime, { tenantId: a.tenant.id, platformActor: true }, (tx) =>
      tx.subscription.findMany(),
    );
    expect(scoped.map((s) => s.tenantId)).toEqual([a.tenant.id]);
    const all = await withContext(runtime, { userId: a.tenant.id, platformActor: true }, (tx) =>
      tx.subscription.count(),
    );
    expect(all).toBeGreaterThan(1);
  });

  it('hides other organisations from a tenant context without the platform flag', async () => {
    const a = await organisation('ListA', 'LITE');
    const tenants = await withContext(runtime, { tenantId: a.tenant.id }, (tx) => tx.tenant.findMany());
    expect(tenants.map((t) => t.id)).toEqual([a.tenant.id]);
  });
});
