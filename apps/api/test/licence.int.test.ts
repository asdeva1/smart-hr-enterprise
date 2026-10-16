/**
 * In-house licensing through the real API and database: an installation verifies signed licences offline,
 * takes every organisation's modules and limits from the current licence, ignores subscriptions and
 * overrides, caps organisations, and turns read-only (never hidden) when the licence lapses.
 */
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDatabaseClient } from '@smart-hr/database';
import { exportPublicKey, signLicence, type LicencePayload } from '@smart-hr/licensing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import { Browser, Fixtures, ownerClient, requireEnv, startApp, testEnv } from './helpers.js';

const db = ownerClient();
const runtime = createDatabaseClient({ connectionString: requireEnv('DATABASE_URL'), maxConnections: 2 });
const fx = new Fixtures(db);
const signing = generateKeyPairSync('ed25519');
const stranger = generateKeyPairSync('ed25519');
const PUBLIC_KEYS = `k1:${exportPublicKey(signing.publicKey)}`;
const DAY = 86_400_000;
const installed: string[] = [];

let inHouse: NestExpressApplication;
let saas: NestExpressApplication;
let operator: Browser;
let operatorId: string;
let installationId: string;
let tenantId: string;
let owner: Browser;
let ownerEmail: string;

function licence(overrides: Partial<LicencePayload> = {}, key = signing.privateKey): string {
  const now = Date.now();
  const payload: LicencePayload = {
    v: 1,
    licenceId: randomUUID(),
    keyId: 'k1',
    customer: { name: 'Acme Hospitals' },
    deploymentModel: 'IN_HOUSE',
    plan: { code: 'ENTERPRISE', name: 'Enterprise' },
    features: ['hr.core', 'leave.basic'],
    limits: { 'users.max': 50 },
    supportLevel: 'PRIORITY',
    issuedAt: new Date(now).toISOString(),
    notBefore: new Date(now - DAY).toISOString(),
    expiresAt: new Date(now + 365 * DAY).toISOString(),
    graceDays: 30,
    maxOrganisations: null,
    installationId: null,
    ...overrides,
  };
  installed.push(payload.licenceId);
  return signLicence(payload, key);
}

const install = (browser: Browser, text: string) =>
  browser.send('put', '/v1/platform/licence', { licence: text });

beforeAll(async () => {
  await syncPlanCatalogue(db);
  installationId = (await db.installation.findFirstOrThrow()).id;
  // Start from "no licence installed" for this file; earlier runs' rows are marked replaced, never deleted.
  await db.installationLicence.updateMany({ where: { replacedAt: null }, data: { replacedAt: new Date() } });
  inHouse = await startApp(testEnv({ DEPLOYMENT_MODE: 'inhouse', LICENCE_PUBLIC_KEYS: PUBLIC_KEYS }));
  saas = await startApp(testEnv({ LICENCE_PUBLIC_KEYS: PUBLIC_KEYS }));

  const admin = await fx.user('lic-operator', { platformAdmin: true });
  operatorId = admin.id;
  operator = new Browser(inHouse);
  expect((await operator.login(admin.email)).status).toBe(200);

  // A subscription that would grant everything: in-house it must be ignored.
  const tenant = await fx.tenant('Licensed Org', 'ACTIVE', { plan: 'ENTERPRISE' });
  tenantId = tenant.id;
  const ownerUser = await fx.user('lic-owner');
  ownerEmail = ownerUser.email;
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(inHouse);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
});

afterAll(async () => {
  await inHouse?.close();
  await saas?.close();
  await db.installationLicence.updateMany({ where: { replacedAt: null }, data: { replacedAt: new Date() } });
  await fx.cleanup();
  await runtime.$disconnect();
  await db.$disconnect();
});

describe('without a licence', () => {
  it('runs the foundation but no paid modules, whatever the subscription says', async () => {
    const session = (await owner.get('/v1/auth/session')).body;
    expect(session.deploymentMode).toBe('inhouse');
    expect(session.activeTenant.plan).toMatchObject({ code: null, status: 'NONE', features: [] });
    // Organisation administration is never gated.
    expect((await owner.get('/v1/org/companies')).status).toBe(200);
  });

  it('shows the installation id to operators only', async () => {
    const res = await operator.get('/v1/platform/licence');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ deploymentMode: 'inhouse', installationId, current: null });
    expect((await owner.get('/v1/platform/licence')).status).toBe(403);
  });
});

describe('installing a licence', () => {
  it('refuses forged, foreign, expired and wrong-installation licences, and records the attempt', async () => {
    const good = licence();
    const [prefix, body, sig] = good.split('.') as [string, string, string];
    const edited = JSON.parse(Buffer.from(body, 'base64url').toString()) as LicencePayload;
    edited.features = ['payroll', 'finance', 'hr.core'];
    const forged = `${prefix}.${Buffer.from(JSON.stringify(edited)).toString('base64url')}.${sig}`;

    const cases: [string, string][] = [
      [forged, 'LICENCE_INVALID'],
      [licence({ keyId: 'k9' }, stranger.privateKey), 'LICENCE_INVALID'],
      [licence({}, stranger.privateKey), 'LICENCE_INVALID'],
      [
        licence({
          notBefore: new Date(Date.now() - 400 * DAY).toISOString(),
          expiresAt: new Date(Date.now() - 60 * DAY).toISOString(),
        }),
        'LICENCE_EXPIRED',
      ],
      [licence({ installationId: randomUUID() }), 'LICENCE_WRONG_INSTALLATION'],
    ];
    for (const [text, code] of cases) {
      const res = await install(operator, text);
      expect(res.status, code).toBe(422);
      expect(res.body.code).toBe(code);
    }
    expect((await install(operator, 'not a licence')).status).toBe(400);
    expect(await db.installationLicence.count({ where: { replacedAt: null } })).toBe(0);
    expect(
      await db.auditEvent.count({
        where: { action: 'platform.licence.install', outcome: 'FAILURE', actorUserId: operatorId },
      }),
    ).toBeGreaterThanOrEqual(3);
  });

  it('needs a platform operator with a recent password entry', async () => {
    expect((await install(owner, licence())).status).toBe(403);
    await db.userSession.updateMany({ where: { userId: operatorId }, data: { reauthenticatedAt: null } });
    expect((await install(operator, licence())).body.code).toBe('REAUTH_REQUIRED');
    expect(
      (await operator.send('post', '/v1/auth/reauthenticate', { password: 'violet harbour sunrise 42' }))
        .status,
    ).toBe(204);
  });

  it('applies a valid licence to every organisation, ignoring subscriptions and overrides', async () => {
    const text = licence({ installationId });
    const res = await install(operator, text);
    expect(res.status).toBe(200);
    expect(res.body.state).toMatchObject({ status: 'VALID' });

    const plan = (await owner.get('/v1/auth/session')).body.activeTenant.plan;
    expect(plan).toMatchObject({ code: 'ENTERPRISE', status: 'ACTIVE', access: 'FULL' });
    expect([...plan.features].sort()).toEqual(['hr.core', 'leave.basic']);

    const overview = (await operator.get('/v1/platform/licence')).body;
    expect(overview.current.payload).toMatchObject({
      customer: { name: 'Acme Hospitals' },
      boundToThisInstallation: true,
    });
    expect(overview.current).not.toHaveProperty('token');
    expect(JSON.stringify(overview)).not.toContain(text);

    // Subscriptions and overrides can't widen an in-house licence.
    const override = await operator.send('post', `/v1/platform/tenants/${tenantId}/overrides`, {
      kind: 'FEATURE',
      key: 'payroll',
      enabled: true,
      reason: 'try to self-grant',
    });
    expect(override.status).toBe(409);
    expect(override.body.code).toBe('SUBSCRIPTIONS_NOT_USED');

    // The same licence can't be installed twice.
    expect((await install(operator, text)).body.code).toBe('LICENCE_ALREADY_INSTALLED');

    // The owner's plan page describes the licence, not the ignored subscription.
    const page = (await owner.get('/v1/tenant/plan')).body;
    expect(page).toMatchObject({
      source: 'licence',
      subscription: null,
      licence: { customer: 'Acme Hospitals', supportLevel: 'PRIORITY', graceDays: 30, verified: true },
    });
  });

  it('replaces the current licence and keeps the history', async () => {
    expect((await install(operator, licence({ features: ['hr.core'] }))).status).toBe(200);
    expect(await db.installationLicence.count({ where: { replacedAt: null } })).toBe(1);
    const history = (await operator.get('/v1/platform/licence')).body.history as {
      replacedAt: string | null;
    }[];
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect((await owner.get('/v1/auth/session')).body.activeTenant.plan.features).toEqual(['hr.core']);
  });
});

describe('licence limits and lapses', () => {
  it('caps how many organisations the installation holds', async () => {
    const holding = await db.tenant.count({ where: { status: { not: 'ARCHIVED' } } });
    expect((await install(operator, licence({ maxOrganisations: holding }))).status).toBe(200);
    const res = await operator.send('post', '/v1/platform/tenants', {
      name: 'One Too Many',
      slug: `one-too-many-${fx.run}`,
      ownerEmail: `too-many-${fx.run}@test.local`,
      ownerName: 'Too Many',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LICENCE_LIMIT_REACHED');
    const created = await db.user.findUnique({ where: { email: `too-many-${fx.run}@test.local` } });
    if (created) fx.trackUser(created.id);
    expect(await db.tenant.count({ where: { slug: `one-too-many-${fx.run}` } })).toBe(0);
  });

  it('keeps working in grace, then becomes read-only without hiding anything', async () => {
    // A licence that ended 10 days ago, with 30 days' grace, can still be installed and keeps working.
    const lapsed = licence({
      notBefore: new Date(Date.now() - 400 * DAY).toISOString(),
      expiresAt: new Date(Date.now() - 10 * DAY).toISOString(),
      graceDays: 30,
    });
    const grace = await install(operator, lapsed);
    expect(grace.status).toBe(200);
    expect(grace.body.state.status).toBe('GRACE');
    expect((await owner.get('/v1/auth/session')).body.activeTenant.plan).toMatchObject({
      status: 'GRACE',
      access: 'FULL',
    });

    // Past grace. Installing an expired licence is refused, so store one directly, as if the installed
    // licence had since run out.
    const expired = licence({
      notBefore: new Date(Date.now() - 400 * DAY).toISOString(),
      expiresAt: new Date(Date.now() - 60 * DAY).toISOString(),
      graceDays: 30,
    });
    await db.installationLicence.updateMany({
      where: { replacedAt: null },
      data: { replacedAt: new Date() },
    });
    await db.installationLicence.create({
      data: {
        licenceId: installed.at(-1)!,
        token: expired,
        customerName: 'Acme Hospitals',
        planCode: 'ENTERPRISE',
        expiresAt: new Date(Date.now() - 60 * DAY),
      },
    });
    const plan = (await owner.get('/v1/auth/session')).body.activeTenant.plan;
    expect(plan).toMatchObject({ status: 'EXPIRED', access: 'READ_ONLY' });
    expect(plan.features).toContain('hr.core');
    expect((await operator.get('/v1/platform/licence')).body.current.state.status).toBe('EXPIRED');
  });

  it('keeps a stored licence whose key is no longer trusted readable, but read-only', async () => {
    const other = await startApp(
      testEnv({
        DEPLOYMENT_MODE: 'inhouse',
        LICENCE_PUBLIC_KEYS: `k1:${exportPublicKey(stranger.publicKey)}`,
      }),
    );
    try {
      const browser = new Browser(other);
      expect((await browser.login(ownerEmail)).status).toBe(200);
      const plan = (await browser.get('/v1/auth/session')).body.activeTenant.plan;
      expect(plan).toMatchObject({ status: 'EXPIRED', access: 'READ_ONLY' });
      expect(plan.features).toContain('hr.core');
      const overview = await new Browser(other).get('/v1/platform/licence');
      expect(overview.status).toBe(401);
    } finally {
      await other.close();
    }
  });
});

describe('other deployment modes', () => {
  it('refuses licences in SaaS, where subscriptions apply', async () => {
    const browser = new Browser(saas);
    const admin = await fx.user('lic-saas-operator', { platformAdmin: true });
    expect((await browser.login(admin.email)).status).toBe(200);
    const res = await install(browser, licence());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LICENCE_NOT_USED');
    expect((await browser.get('/v1/auth/session')).body.deploymentMode).toBe('saas');
  });

  it('refuses to start in-house without public keys, or with sign-up turned on', () => {
    expect(() => testEnv({ DEPLOYMENT_MODE: 'inhouse', LICENCE_PUBLIC_KEYS: '' })).toThrow(
      /LICENCE_PUBLIC_KEYS/,
    );
    expect(() =>
      testEnv({ DEPLOYMENT_MODE: 'inhouse', LICENCE_PUBLIC_KEYS: PUBLIC_KEYS, SIGNUP_ENABLED: 'true' }),
    ).toThrow(/SIGNUP_ENABLED/);
  });
});
