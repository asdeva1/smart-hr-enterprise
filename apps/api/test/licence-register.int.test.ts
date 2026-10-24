/**
 * The register of licences issued to in-house customers: recording, renewal reminders, revoking, and the
 * database rules that keep the register honest.
 */
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { exportPublicKey, signLicence, type LicencePayload } from '@smart-hr/licensing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renewalStage } from '../src/platform/licence-register.service.js';
import { createDatabaseClient } from '@smart-hr/database';
import { Browser, Fixtures, ownerClient, requireEnv, startApp, testEnv } from './helpers.js';

const db = ownerClient();
const fx = new Fixtures(db);
const signing = generateKeyPairSync('ed25519');
const DAY = 86_400_000;
const recorded: string[] = [];

let app: NestExpressApplication;
let operator: Browser;
let member: Browser;

function licence(days: number, customer = 'Register Test Co'): { text: string; id: string } {
  const now = Date.now();
  const id = randomUUID();
  const payload: LicencePayload = {
    v: 1,
    licenceId: id,
    keyId: 'k1',
    customer: { name: customer },
    deploymentModel: 'IN_HOUSE',
    plan: { code: 'ENTERPRISE', name: 'Enterprise' },
    features: ['hr.core'],
    limits: {},
    supportLevel: 'STANDARD',
    issuedAt: new Date(now - 30 * DAY).toISOString(),
    notBefore: new Date(now - 30 * DAY).toISOString(),
    expiresAt: new Date(now + days * DAY).toISOString(),
    graceDays: 10,
    maxOrganisations: null,
    installationId: null,
  };
  recorded.push(id);
  return { text: signLicence(payload, signing.privateKey), id };
}

beforeAll(async () => {
  app = await startApp(testEnv({ LICENCE_PUBLIC_KEYS: `k1:${exportPublicKey(signing.publicKey)}` }));
  const admin = await fx.user('reg-operator', { platformAdmin: true });
  operator = new Browser(app);
  expect((await operator.login(admin.email)).status).toBe(200);
  const plain = await fx.user('reg-member');
  member = new Browser(app);
  expect((await member.login(plain.email)).status).toBe(200);
});

afterAll(async () => {
  await app?.close();
  await db.issuedLicence.deleteMany({ where: { licenceId: { in: recorded } } });
  await fx.cleanup();
  await db.$disconnect();
});

describe('renewal stages', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const at = (days: number) => new Date(now.getTime() + days * DAY);
  it('counts down to expiry, then grace, then expired', () => {
    expect(renewalStage({ expiresAt: at(90), graceDays: 10 }, now).stage).toBe('OK');
    expect(renewalStage({ expiresAt: at(45), graceDays: 10 }, now).stage).toBe('SOON');
    expect(renewalStage({ expiresAt: at(30), graceDays: 10 }, now).stage).toBe('DUE');
    expect(renewalStage({ expiresAt: at(-3), graceDays: 10 }, now).stage).toBe('GRACE');
    expect(renewalStage({ expiresAt: at(-11), graceDays: 10 }, now).stage).toBe('EXPIRED');
    expect(renewalStage({ expiresAt: at(90), graceDays: 10, revoked: true }, now).stage).toBe('REVOKED');
  });
});

describe('the register', () => {
  it('is for platform operators only', async () => {
    expect((await member.get('/v1/platform/licence-register')).status).toBe(403);
    expect(
      (await member.send('post', '/v1/platform/licence-register', { licence: 'SHRL1.a.b' })).status,
    ).toBe(403);
  });

  it('records a licence and lists it with days left and a stage', async () => {
    const near = licence(20);
    const res = await operator.send('post', '/v1/platform/licence-register', {
      licence: near.text,
      notes: 'Renewal call booked',
    });
    expect(res.status).toBe(201);
    expect(res.body.signatureChecked).toBe(true);
    const list = await operator.get('/v1/platform/licence-register');
    const row = list.body.licences.find((l: { licenceId: string }) => l.licenceId === near.id);
    expect(row).toMatchObject({
      customerName: 'Register Test Co',
      stage: 'DUE',
      notes: 'Renewal call booked',
    });
    expect(row.daysLeft).toBeGreaterThanOrEqual(19);
    expect(list.body.summary.licencesDue).toBeGreaterThanOrEqual(1);
  });

  it('refuses a duplicate, a tampered licence and a licence that is not one', async () => {
    const once = licence(200);
    expect(
      (await operator.send('post', '/v1/platform/licence-register', { licence: once.text })).status,
    ).toBe(201);
    expect(
      (await operator.send('post', '/v1/platform/licence-register', { licence: once.text })).status,
    ).toBe(409);
    const [h, p, s] = once.text.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p!, 'base64url').toString()), licenceId: randomUUID() })).toString('base64url')}.${s}`;
    expect((await operator.send('post', '/v1/platform/licence-register', { licence: forged })).status).toBe(
      422,
    );
    expect((await operator.send('post', '/v1/platform/licence-register', { licence: 'hello' })).status).toBe(
      400,
    );
  });

  it('a renewal stops the old licence from raising reminders', async () => {
    const old = licence(5, 'Renewal Co');
    await operator.send('post', '/v1/platform/licence-register', { licence: old.text });
    const oldRow = (await operator.get('/v1/platform/licence-register')).body.licences.find(
      (l: { licenceId: string }) => l.licenceId === old.id,
    );
    const next = licence(365, 'Renewal Co');
    const renewed = await operator.send('post', '/v1/platform/licence-register', {
      licence: next.text,
      renews: oldRow.id,
    });
    expect(renewed.status).toBe(201);
    const after = (await operator.get('/v1/platform/licence-register')).body.licences.find(
      (l: { licenceId: string }) => l.licenceId === old.id,
    );
    expect(after.renewedById).toBe(renewed.body.id);
    // The same licence cannot be renewed twice.
    const again = await operator.send('post', '/v1/platform/licence-register', {
      licence: licence(365).text,
      renews: oldRow.id,
    });
    expect(again.status).toBe(404);
  });

  it('revokes with a reason, keeps the record, and can send the licence text again', async () => {
    const item = licence(100, 'Revoked Co');
    const created = await operator.send('post', '/v1/platform/licence-register', { licence: item.text });
    const id = created.body.id as string;
    expect(
      (await operator.send('post', `/v1/platform/licence-register/${id}/revoke`, { reason: '' })).status,
    ).toBe(400);
    expect(
      (
        await operator.send('post', `/v1/platform/licence-register/${id}/revoke`, {
          reason: 'Contract ended',
        })
      ).status,
    ).toBe(201);
    expect(
      (await operator.send('post', `/v1/platform/licence-register/${id}/revoke`, { reason: 'Again please' }))
        .status,
    ).toBe(404);
    const row = (await operator.get('/v1/platform/licence-register')).body.licences.find(
      (l: { id: string }) => l.id === id,
    );
    expect(row).toMatchObject({ status: 'REVOKED', stage: 'REVOKED', revokedReason: 'Contract ended' });
    expect((await operator.get(`/v1/platform/licence-register/${id}/licence`)).body.licence).toBe(item.text);
  });

  it('lists hosted subscriptions and trials that are about to end', async () => {
    const tenant = await fx.tenant('Ending Soon Org', 'ACTIVE', { plan: 'LITE' });
    await db.subscription.update({
      where: { tenantId: tenant.id },
      data: { status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 10 * DAY) },
    });
    const list = await operator.get('/v1/platform/licence-register');
    expect(list.body.renewals.find((r: { tenantId: string }) => r.tenantId === tenant.id)).toMatchObject({
      organisation: 'Ending Soon Org',
      stage: 'DUE',
    });
  });
});

describe('database rules', () => {
  it('the runtime role cannot delete or rewrite a licence record', async () => {
    const rt = createDatabaseClient({ connectionString: requireEnv('DATABASE_URL'), maxConnections: 1 });
    const row = await db.issuedLicence.findFirstOrThrow({ where: { licenceId: { in: recorded } } });
    await expect(rt.$executeRaw`DELETE FROM issued_licence WHERE id = ${row.id}::uuid`).rejects.toThrow();
    await expect(
      rt.$executeRaw`UPDATE issued_licence SET expires_at = now() + interval '10 years' WHERE id = ${row.id}::uuid`,
    ).rejects.toThrow();
    await rt.$disconnect();
  });
});
