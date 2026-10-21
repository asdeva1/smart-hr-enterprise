/**
 * Integrations through the real API and database: webhook endpoints (public https addresses only, secret shown
 * once and kept encrypted), events queued in the same transaction as the change, and API keys that read a small
 * directory and nothing else.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import { Browser, Fixtures, ownerClient, startApp, testEnv } from './helpers.js';

const db = ownerClient();
const fx = new Fixtures(db);
let app: NestExpressApplication;
let tenantId: string;
let owner: Browser;
let plain: Browser;
let acme: string;
const year = new Date().getUTCFullYear();
const URL_OK = 'https://hooks.example.com/smart-hr';

const hire = (firstName: string) =>
  owner.send('post', '/v1/employees', {
    firstName,
    lastName: 'Hook',
    companyId: acme,
    dateOfJoining: `${year - 1}-01-01`,
  });

const withKey = (key: string, path: string) =>
  request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${key}`);

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  const tenant = await fx.tenant('Integrations');
  tenantId = tenant.id;
  const ownerUser = await fx.user('int-owner');
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  acme = (await fx.company(tenantId, 'ACME')).id;

  const user = await fx.user('int-plain');
  await fx.member(tenantId, user.id);
  plain = new Browser(app);
  expect((await plain.login(user.email)).status).toBe(200);
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await db.$disconnect();
});

describe('webhook endpoints', () => {
  it('shows the signing secret once, keeps it encrypted, and never lists it', async () => {
    const created = await owner.send('post', '/v1/integrations/webhooks', {
      name: 'HRIS sync',
      url: URL_OK,
      events: ['employee.created', 'employee.created'],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.secret).toMatch(/^whsec_/);
    expect(created.body.events).toEqual(['employee.created']);

    const row = await db.webhookEndpoint.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.secretEnc).not.toContain(created.body.secret);
    expect(row.secretEnc.startsWith('v1.')).toBe(true);

    const list = await owner.get('/v1/integrations/webhooks');
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain('whsec_');
    expect(JSON.stringify(list.body)).not.toContain('secret');
    await owner.send('patch', `/v1/integrations/webhooks/${created.body.id}`, { status: 'DISABLED' });
  });

  it('refuses addresses that are not public https', async () => {
    for (const url of [
      'http://hooks.example.com/x',
      'https://localhost/x',
      'https://10.0.0.5/x',
      'https://169.254.169.254/latest',
      'https://user:pw@hooks.example.com/x',
    ]) {
      const res = await owner.send('post', '/v1/integrations/webhooks', {
        name: 'Bad',
        url,
        events: ['employee.created'],
      });
      expect(res.status, url).toBe(400);
    }
  });

  it('is for administrators on plans that include integrations', async () => {
    const body = { name: 'Nope', url: URL_OK, events: ['employee.created'] };
    expect((await plain.send('post', '/v1/integrations/webhooks', body)).status).toBe(403);
    expect((await plain.get('/v1/integrations/api-keys')).status).toBe(403);

    const lite = await fx.tenant('IntLite', 'ACTIVE', { plan: 'LITE' });
    const user = await fx.user('int-lite');
    await fx.member(lite.id, user.id, true);
    const b = new Browser(app);
    await b.login(user.email);
    const res = await b.send('post', '/v1/integrations/webhooks', body);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ENTITLEMENT_REQUIRED');
  });

  it('rotates the secret, so the old one stops working', async () => {
    const created = await owner.send('post', '/v1/integrations/webhooks', {
      name: 'Rotate me',
      url: URL_OK,
      events: ['employee.created'],
    });
    const before = (await db.webhookEndpoint.findUniqueOrThrow({ where: { id: created.body.id } })).secretEnc;
    const rotated = await owner.send('post', `/v1/integrations/webhooks/${created.body.id}/rotate-secret`);
    expect(rotated.status).toBe(201);
    expect(rotated.body.secret).not.toBe(created.body.secret);
    const after = (await db.webhookEndpoint.findUniqueOrThrow({ where: { id: created.body.id } })).secretEnc;
    expect(after).not.toBe(before);
    await owner.send('patch', `/v1/integrations/webhooks/${created.body.id}`, { status: 'DISABLED' });
  });
});

describe('events', () => {
  let hookA: string;
  let hookB: string;

  it('queue one delivery per subscribed endpoint, in step with the change', async () => {
    hookA = (
      await owner.send('post', '/v1/integrations/webhooks', {
        name: 'A',
        url: URL_OK,
        events: ['employee.created', 'employee.status_changed'],
      })
    ).body.id as string;
    hookB = (
      await owner.send('post', '/v1/integrations/webhooks', {
        name: 'B',
        url: 'https://other.example.com/in',
        events: ['operations.item.created'],
      })
    ).body.id as string;

    const e = await hire('Eventful');
    expect(e.status, JSON.stringify(e.body)).toBe(201);
    const rows = await db.webhookDelivery.findMany({ where: { tenantId, eventType: 'employee.created' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.endpointId).toBe(hookA);
    expect(rows[0]!.payload).toMatchObject({
      type: 'employee.created',
      data: { employeeId: e.body.id, employeeCode: e.body.employeeCode },
    });
    // Ids and codes only: no names or contact details.
    expect(JSON.stringify(rows[0]!.payload)).not.toContain('Eventful');

    const notice = await owner.send('post', `/v1/employees/${e.body.id}/lifecycle`, {
      action: 'notice',
      version: e.body.version,
      noticeGivenOn: `${year}-01-10`,
      lastWorkingDay: `${year}-02-10`,
    });
    expect(notice.status, JSON.stringify(notice.body)).toBe(200);
    const changed = await db.webhookDelivery.findMany({
      where: { tenantId, eventType: 'employee.status_changed' },
    });
    expect(changed).toHaveLength(1);
    expect(changed[0]!.payload).toMatchObject({ data: { status: 'ON_NOTICE', action: 'notice' } });
  });

  it('are sent for work items to the endpoints that asked, and not to others', async () => {
    const ws = await owner.send('post', '/v1/operations/workspaces', {
      companyId: acme,
      code: 'int-help',
      name: 'Help desk',
      template: 'service_requests',
    });
    expect(ws.status, JSON.stringify(ws.body)).toBe(201);
    const item = await owner.send('post', `/v1/operations/workspaces/${ws.body.id}/items`, {
      title: 'Badge reader',
      values: { category: 'Facilities' },
    });
    expect(item.status, JSON.stringify(item.body)).toBe(201);
    const rows = await db.webhookDelivery.findMany({
      where: { tenantId, eventType: 'operations.item.created' },
    });
    expect(rows.map((r) => r.endpointId)).toEqual([hookB]);
    expect(JSON.stringify(rows[0]!.payload)).not.toContain('Badge reader');
  });

  it('are not queued for a switched-off endpoint, and a test event goes to one endpoint only', async () => {
    await owner.send('patch', `/v1/integrations/webhooks/${hookA}`, { status: 'DISABLED' });
    const before = await db.webhookDelivery.count({ where: { tenantId, endpointId: hookA } });
    await hire('Quiet');
    expect(await db.webhookDelivery.count({ where: { tenantId, endpointId: hookA } })).toBe(before);

    expect((await owner.send('post', `/v1/integrations/webhooks/${hookA}/test`)).status).toBe(409);
    const test = await owner.send('post', `/v1/integrations/webhooks/${hookB}/test`);
    expect(test.status).toBe(201);
    const rows = await db.webhookDelivery.findMany({ where: { tenantId, eventType: 'webhook.test' } });
    expect(rows.map((r) => r.endpointId)).toEqual([hookB]);
  });

  it('shows an administrator the delivery history without payloads', async () => {
    const res = await owner.get(`/v1/integrations/webhooks/${hookB}/deliveries`);
    expect(res.status).toBe(200);
    expect((res.body as { eventType: string }[]).map((d) => d.eventType).sort()).toEqual([
      'operations.item.created',
      'webhook.test',
    ]);
    expect(JSON.stringify(res.body)).not.toContain('payload');
  });
});

describe('API keys', () => {
  let key: string;
  let keyId: string;

  it('are shown in full once and listed only by their start', async () => {
    const created = await owner.send('post', '/v1/integrations/api-keys', {
      name: 'SmartCode',
      scopes: ['employees.read'],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    key = created.body.key as string;
    keyId = created.body.id as string;
    expect(key).toMatch(/^shr_[a-z0-9]{8}_/);

    const row = await db.apiKey.findUniqueOrThrow({ where: { id: keyId } });
    expect(row.secretHash).not.toContain(key.split('_')[2]!);
    const list = await owner.get('/v1/integrations/api-keys');
    expect(JSON.stringify(list.body)).not.toContain(key);
    expect(list.body[0]).toMatchObject({ name: 'SmartCode', active: true, prefix: `shr_${row.prefix}` });
  });

  it('read the directory, current people by default, without private details', async () => {
    const res = await withKey(key, '/v1/integrations/api/employees');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.items[0]).toHaveProperty('employeeCode');
    // Exactly these fields: nothing about identity numbers, bank, pay, birth date or phone.
    expect(Object.keys((res.body as { items: object[] }).items[0]!).sort()).toEqual([
      'companyCode',
      'dateOfJoining',
      'department',
      'designation',
      'employeeCode',
      'firstName',
      'id',
      'lastName',
      'lastWorkingDay',
      'managerCode',
      'status',
      'workEmail',
    ]);
    expect((await db.apiKey.findUniqueOrThrow({ where: { id: keyId } })).lastUsedAt).not.toBeNull();
  });

  it('only work on the API for outside systems, not on the app’s own routes', async () => {
    expect((await withKey(key, '/v1/employees')).status).toBe(401);
    expect((await withKey(key, '/v1/integrations/api-keys')).status).toBe(401);
  });

  it('are refused when wrong, missing, unknown or revoked, always the same way', async () => {
    const tampered = `${key.slice(0, -2)}xx`;
    const unknown = 'shr_zzzzzzzz_' + 'a'.repeat(43);
    for (const bad of [tampered, unknown, 'garbage']) {
      const res = await withKey(bad, '/v1/integrations/api/employees');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_API_KEY');
    }
    expect((await request(app.getHttpServer()).get('/v1/integrations/api/employees')).status).toBe(401);

    expect((await owner.send('post', `/v1/integrations/api-keys/${keyId}/revoke`)).status).toBe(201);
    expect((await withKey(key, '/v1/integrations/api/employees')).status).toBe(401);
  });

  it('stop at their expiry date', async () => {
    const created = await owner.send('post', '/v1/integrations/api-keys', {
      name: 'Short',
      scopes: ['employees.read'],
      expiresInDays: 1,
    });
    const short = created.body.key as string;
    expect((await withKey(short, '/v1/integrations/api/employees')).status).toBe(200);
    await db.apiKey.update({
      where: { id: created.body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await withKey(short, '/v1/integrations/api/employees')).status).toBe(401);
  });

  it('see only their own organisation', async () => {
    const other = await fx.tenant('IntOther');
    const otherUser = await fx.user('int-other');
    await fx.member(other.id, otherUser.id, true);
    const b = new Browser(app);
    await b.login(otherUser.email);
    const created = await b.send('post', '/v1/integrations/api-keys', {
      name: 'Other',
      scopes: ['employees.read'],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const res = await withKey(created.body.key as string, '/v1/integrations/api/employees');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it('stop working when the plan no longer includes integrations', async () => {
    const lite = await fx.tenant('IntDowngrade');
    const user = await fx.user('int-down');
    await fx.member(lite.id, user.id, true);
    const b = new Browser(app);
    await b.login(user.email);
    const created = await b.send('post', '/v1/integrations/api-keys', {
      name: 'Soon gone',
      scopes: ['employees.read'],
    });
    const soon = created.body.key as string;
    expect((await withKey(soon, '/v1/integrations/api/employees')).status).toBe(200);
    await fx.subscribe(lite.id, 'LITE');
    expect((await withKey(soon, '/v1/integrations/api/employees')).status).toBe(403);
  });
});
