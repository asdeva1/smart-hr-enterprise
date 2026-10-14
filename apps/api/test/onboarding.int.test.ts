/**
 * Organisation onboarding and lifecycle through the real API and database: platform provisioning, suspension,
 * offboarding (read-only + export), archiving, branding, data export, self-service sign-up and platform
 * operators — plus the database rules underneath.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDatabaseClient, withContext } from '@smart-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiEnv } from '../src/config/env.js';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import {
  Browser,
  DEFAULT_PASSWORD,
  Fixtures,
  ownerClient,
  queuedEmails,
  requireEnv,
  resetTokenFrom,
  startApp,
  testEnv,
} from './helpers.js';

let env: ApiEnv;
let app: NestExpressApplication;
const db = ownerClient();
const runtime = createDatabaseClient({ connectionString: requireEnv('DATABASE_URL'), maxConnections: 2 });
const fx = new Fixtures(db);
let operator: Browser;
let operatorId: string;

beforeAll(async () => {
  await syncPlanCatalogue(db);
  env = testEnv({ SIGNUP_ENABLED: 'true' });
  app = await startApp(env);
  const admin = await fx.user('onb-operator', { platformAdmin: true });
  operatorId = admin.id;
  operator = new Browser(app);
  expect((await operator.login(admin.email)).status).toBe(200);
});

afterAll(async () => {
  await app?.close();
  await db.signupRequest.deleteMany({ where: { email: { contains: fx.run } } });
  await fx.cleanup();
  await runtime.$disconnect();
  await db.$disconnect();
});

async function organisation(name: string) {
  const tenant = await fx.tenant(name);
  const ownerUser = await fx.user(`${name}-owner`);
  await fx.member(tenant.id, ownerUser.id, true);
  const owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  return { tenant, ownerUser, owner };
}

describe('platform provisioning', () => {
  it('creates an organisation for a new owner, who joins through the emailed invitation', async () => {
    const ownerEmail = `new-owner-${fx.run}@test.local`;
    const plans = (await operator.get('/v1/platform/plans')).body as {
      code: string;
      versions: { id: string; status: string }[];
    }[];
    const pro = plans.find((p) => p.code === 'PRO')!.versions.find((v) => v.status === 'PUBLISHED')!.id;
    const res = await operator.send('post', '/v1/platform/tenants', {
      name: 'Globex Health',
      slug: `globex-${fx.run}`,
      ownerEmail,
      ownerName: 'Gita Owner',
      subscription: { planVersionId: pro, status: 'TRIAL' },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Globex Health', ownerInvited: true });
    fx.trackTenant(res.body.id as string);
    const user = await db.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    fx.trackUser(user.id);

    // Owner, built-in roles and a trial subscription, all inside the new organisation.
    const membership = await db.tenantMembership.findFirstOrThrow({
      where: { tenantId: res.body.id, userId: user.id },
    });
    expect(membership.isTenantAdmin).toBe(true);
    expect(await db.role.count({ where: { tenantId: res.body.id, isSystem: true } })).toBe(4);
    expect((await db.subscription.findUniqueOrThrow({ where: { tenantId: res.body.id } })).status).toBe(
      'TRIAL',
    );

    const [email] = await queuedEmails(env, ownerEmail);
    const token = resetTokenFrom(email!);
    const reset = await new Browser(app).send('post', '/v1/auth/password/reset', {
      token,
      newPassword: 'quartz meadow lantern 55',
    });
    expect(reset.status).toBe(204);
    const owner = new Browser(app);
    const login = await owner.login(ownerEmail, 'quartz meadow lantern 55');
    expect(login.status).toBe(200);
    expect(login.body.activeTenant).toMatchObject({ name: 'Globex Health', isTenantAdmin: true });
    expect(login.body.activeTenant.plan).toMatchObject({ code: 'PRO', status: 'TRIAL' });
  });

  it('refuses a taken address and non-operators', async () => {
    const taken = await operator.send('post', '/v1/platform/tenants', {
      name: 'Copy',
      slug: (await fx.tenant('Taken')).slug,
      ownerEmail: `copy-${fx.run}@test.local`,
      ownerName: 'Copy',
    });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('SLUG_TAKEN');
    const created = await db.user.findUnique({ where: { email: `copy-${fx.run}@test.local` } });
    if (created) fx.trackUser(created.id);

    const org = await organisation('NotOperator');
    const refused = await org.owner.send('post', '/v1/platform/tenants', {
      name: 'Sneaky',
      slug: `sneaky-${fx.run}`,
      ownerEmail: `sneaky-${fx.run}@test.local`,
      ownerName: 'Sneaky',
    });
    expect(refused.status).toBe(403);
  });
});

describe('organisation lifecycle', () => {
  it('suspends all access and gives it back on reactivation', async () => {
    const org = await organisation('Suspend');
    const base = `/v1/platform/tenants/${org.tenant.id}/lifecycle`;
    expect((await operator.send('post', base, { action: 'suspend', reason: 'Legal hold' })).status).toBe(200);
    const blocked = await org.owner.get('/v1/org/companies');
    expect(blocked.status).toBe(403);
    expect((await org.owner.get('/v1/auth/session')).body.activeTenant).toBeNull();

    expect((await operator.send('post', base, { action: 'reactivate' })).status).toBe(200);
    expect((await org.owner.send('post', '/v1/auth/tenant', { tenantId: org.tenant.id })).status).toBe(200);
    expect((await org.owner.get('/v1/org/companies')).status).toBe(200);
  });

  it('makes an offboarding organisation read-only but exportable, then archives it on confirmation', async () => {
    const org = await organisation('Offboard');
    const base = `/v1/platform/tenants/${org.tenant.id}/lifecycle`;
    const archiveTooEarly = await operator.send('post', base, {
      action: 'archive',
      reason: 'Contract ended',
      confirmSlug: org.tenant.slug,
    });
    expect(archiveTooEarly.body.code).toBe('INVALID_TRANSITION');

    expect(
      (await operator.send('post', base, { action: 'start_offboarding', reason: 'Contract ended' })).status,
    ).toBe(200);
    expect((await org.owner.get('/v1/org/companies')).status).toBe(200);
    const write = await org.owner.send('post', '/v1/org/companies', {
      code: `X${fx.run}`,
      name: 'X',
      country: 'IN',
      baseCurrency: 'INR',
      timezone: 'Asia/Kolkata',
    });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('TENANT_OFFBOARDING');
    expect((await org.owner.get('/v1/tenant/export')).status).toBe(200);

    const wrongSlug = await operator.send('post', base, {
      action: 'archive',
      reason: 'Contract ended',
      confirmSlug: 'not-it',
    });
    expect(wrongSlug.body.code).toBe('CONFIRMATION_MISMATCH');
    expect(
      (
        await operator.send('post', base, {
          action: 'archive',
          reason: 'Contract ended',
          confirmSlug: org.tenant.slug,
        })
      ).status,
    ).toBe(200);
    expect((await org.owner.get('/v1/org/companies')).status).toBe(403);
    // Archived is not deleted.
    expect(await db.tenant.findUnique({ where: { id: org.tenant.id } })).toMatchObject({
      status: 'ARCHIVED',
    });
  });

  it('lets only platform actors change an organisation’s status, whatever the code path', async () => {
    const org = await organisation('Guarded');
    await expect(
      withContext(runtime, { tenantId: org.tenant.id }, (tx) =>
        tx.tenant.update({ where: { id: org.tenant.id }, data: { status: 'ARCHIVED' } }),
      ),
    ).rejects.toThrow(/platform operators only/);
    await expect(
      withContext(runtime, { tenantId: org.tenant.id }, (tx) =>
        tx.tenant.create({ data: { slug: `rogue-${fx.run}`, name: 'Rogue' } }),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('branding', () => {
  it('lets administrators set an accessible brand and shows it to members', async () => {
    const org = await organisation('Brand');
    const tooLight = await org.owner.send('put', '/v1/tenant/branding', {
      brandName: 'Acme',
      brandColor: '#ffe066',
      brandLogoUrl: null,
    });
    expect(tooLight.status).toBe(400);

    const ok = await org.owner.send('put', '/v1/tenant/branding', {
      brandName: 'Acme People',
      brandColor: '#1D4F73',
      brandLogoUrl: 'https://cdn.example.com/acme.png',
    });
    expect(ok.status).toBe(200);
    const session = await org.owner.get('/v1/auth/session');
    expect(session.body.activeTenant.branding).toEqual({
      name: 'Acme People',
      color: '#1d4f73',
      logoUrl: 'https://cdn.example.com/acme.png',
    });

    const memberUser = await fx.user('Brand-member');
    await fx.member(org.tenant.id, memberUser.id);
    const member = new Browser(app);
    await member.login(memberUser.email);
    expect((await member.get('/v1/tenant/branding')).body.brandName).toBe('Acme People');
    expect(
      (
        await member.send('put', '/v1/tenant/branding', {
          brandName: 'Hijack',
          brandColor: null,
          brandLogoUrl: null,
        })
      ).status,
    ).toBe(403);
  });
});

describe('data export', () => {
  it('gives owners all of their organisation’s data, and nothing of anyone else’s or any secret', async () => {
    const org = await organisation('Export');
    const other = await organisation('ExportOther');
    const mine = await fx.company(org.tenant.id, 'mine');
    const theirs = await fx.company(other.tenant.id, 'theirs');

    const res = await org.owner.get('/v1/tenant/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="smart-hr-export-/);
    const body = res.body as { format: string; sections: Record<string, unknown> };
    expect(body.format).toBe('smart-hr-export');
    const companies = body.sections.companies as { id: string }[];
    expect(companies.map((c) => c.id)).toEqual([mine.id]);
    const text = JSON.stringify(body);
    expect(text).not.toContain(theirs.id);
    expect(text).not.toMatch(/passwordHash|\$argon2|mfaTotpSecret|tokenHash/);

    const audit = await db.auditEvent.findFirst({
      where: { tenantId: org.tenant.id, action: 'tenant.data.export' },
    });
    expect(audit).not.toBeNull();
  });

  it('is for owners only, and needs a recent password entry', async () => {
    const org = await organisation('ExportAuth');
    const memberUser = await fx.user('ExportAuth-member');
    const m = await fx.member(org.tenant.id, memberUser.id);
    await fx.assign(org.tenant.id, m.id, await fx.systemRole(org.tenant.id, 'org_admin'));
    const member = new Browser(app);
    await member.login(memberUser.email);
    expect((await member.get('/v1/tenant/export')).status).toBe(403);

    await db.userSession.updateMany({
      where: { userId: org.ownerUser.id },
      data: { reauthenticatedAt: null },
    });
    const stale = await org.owner.get('/v1/tenant/export');
    expect(stale.body.code).toBe('REAUTH_REQUIRED');
    expect(
      (await org.owner.send('post', '/v1/auth/reauthenticate', { password: DEFAULT_PASSWORD })).status,
    ).toBe(204);
    expect((await org.owner.get('/v1/tenant/export')).status).toBe(200);
  });
});

describe('self-service sign-up', () => {
  it('creates nothing until the emailed link is used, then creates account, organisation and trial', async () => {
    const email = `signup-${fx.run}@test.local`;
    const start = await new Browser(app).send('post', '/v1/signup', {
      organisationName: 'Initech Labs',
      displayName: 'Ira Founder',
      email,
    });
    expect(start.status).toBe(202);
    expect(await db.user.findUnique({ where: { email } })).toBeNull();

    const [mail] = await queuedEmails(env, email);
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail!.text)![1]!;
    const weak = await new Browser(app).send('post', '/v1/signup/complete', { token, password: 'short' });
    expect(weak.status).toBe(422);

    const done = await new Browser(app).send('post', '/v1/signup/complete', {
      token,
      password: 'nimbus kettle 2026 river',
    });
    expect(done.status).toBe(201);
    expect(done.body).toEqual({ email, organisation: 'Initech Labs' });
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    fx.trackUser(user.id);
    const membership = await db.tenantMembership.findFirstOrThrow({ where: { userId: user.id } });
    fx.trackTenant(membership.tenantId);
    expect(membership.isTenantAdmin).toBe(true);
    const sub = await db.subscription.findUniqueOrThrow({
      where: { tenantId: membership.tenantId },
      include: { planVersion: { include: { plan: true } } },
    });
    expect(sub).toMatchObject({ status: 'TRIAL', planVersion: { plan: { code: 'PRO' } } });

    const again = await new Browser(app).send('post', '/v1/signup/complete', {
      token,
      password: 'nimbus kettle 2026 river',
    });
    expect(again.body.code).toBe('SIGNUP_LINK_INVALID');
    expect((await new Browser(app).login(email, 'nimbus kettle 2026 river')).status).toBe(200);
  });

  it('answers the same for an existing account, and only emails its owner', async () => {
    const existing = await fx.user('signup-existing');
    const res = await new Browser(app).send('post', '/v1/signup', {
      organisationName: 'Duplicate',
      displayName: 'Dup',
      email: existing.email,
    });
    expect(res.status).toBe(202);
    expect(await db.signupRequest.count({ where: { email: existing.email } })).toBe(0);
    const [mail] = await queuedEmails(env, existing.email);
    expect(mail!.subject).toBe('You already have a Smart HR account');
  });

  it('is unavailable unless enabled', async () => {
    const closed = await startApp(testEnv());
    try {
      const res = await new Browser(closed).send('post', '/v1/signup', {
        organisationName: 'Nope',
        displayName: 'Nope',
        email: `nope-${fx.run}@test.local`,
      });
      expect(res.status).toBe(404);
    } finally {
      await closed.close();
    }
  });
});

describe('platform operators', () => {
  it('grants and revokes operator access with a recent password entry, keeping at least one', async () => {
    const candidate = await fx.user('candidate');
    await db.userSession.updateMany({ where: { userId: operatorId }, data: { reauthenticatedAt: null } });
    expect(
      (await operator.send('post', '/v1/platform/operators', { email: candidate.email })).body.code,
    ).toBe('REAUTH_REQUIRED');
    expect(
      (await operator.send('post', '/v1/auth/reauthenticate', { password: DEFAULT_PASSWORD })).status,
    ).toBe(204);

    const grant = await operator.send('post', '/v1/platform/operators', { email: candidate.email });
    expect(grant.body).toMatchObject({ isPlatformAdmin: true });
    const candidateBrowser = new Browser(app);
    await candidateBrowser.login(candidate.email);
    expect((await candidateBrowser.get('/v1/platform/plans')).status).toBe(200);

    expect((await operator.send('delete', `/v1/platform/operators/${operatorId}`)).body.code).toBe(
      'CANNOT_CHANGE_SELF',
    );
    expect((await operator.send('delete', `/v1/platform/operators/${candidate.id}`)).status).toBe(200);
    // Takes effect on the very next request.
    expect((await candidateBrowser.get('/v1/platform/plans')).status).toBe(403);
  });
});
