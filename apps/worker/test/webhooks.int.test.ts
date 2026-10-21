/**
 * Webhook delivery against the real database, running as app_rw like the deployed worker, with a local HTTPS
 * receiver: signed requests, retries with waits, giving up, switching a failing endpoint off, and refusing
 * private addresses. Other test files may leave queued deliveries of their own, so assertions only look at
 * this file's rows.
 */
import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretBox } from '@smart-hr/auth';
import { createDatabaseClient } from '@smart-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadWorkerEnv, parseKeyRing } from '../src/config/env.js';
import { signWebhook, WebhookDeliveryService } from '../src/integrations/webhook-delivery.service.js';

const run = randomUUID().slice(0, 8);
const owner = createDatabaseClient({
  connectionString: process.env.DATABASE_MIGRATOR_URL!,
  maxConnections: 2,
});
const appRole = createDatabaseClient({ connectionString: process.env.DATABASE_URL!, maxConnections: 2 });
// Its own key ring, so the test does not depend on the environment's.
const KEYS = `t1:${randomBytes(32).toString('base64')}`;
const box = new SecretBox(parseKeyRing(KEYS), 't1');
const dir = mkdtempSync(join(tmpdir(), 'hook-'));
const SECRET = `whsec_${run}`;

interface Seen {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}
const seen: Seen[] = [];
let answer = 200;
let server: Server;
let baseUrl: string;
let tenantId: string;
let service: WebhookDeliveryService;
let strict: WebhookDeliveryService;

const env = (extra: Record<string, string> = {}) =>
  loadWorkerEnv({
    ...process.env,
    NODE_ENV: 'test',
    DATA_ENCRYPTION_KEYS: KEYS,
    DATA_ENCRYPTION_KEY_ID: 't1',
    WEBHOOK_ALLOW_PRIVATE_HOSTS: 'true',
    WEBHOOK_MAX_ATTEMPTS: '3',
    WEBHOOK_DISABLE_AFTER: '2',
    WEBHOOK_TIMEOUT_MS: '3000',
    ...extra,
  });

beforeAll(async () => {
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-keyout',
      join(dir, 'k.pem'),
      '-out',
      join(dir, 'c.pem'),
    ],
    { stdio: 'ignore' },
  );
  // The receiver's certificate is self-signed; this only affects the test process.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  server = createServer(
    { key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) },
    (req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        seen.push({ headers: req.headers, body });
        res.writeHead(answer);
        res.end('ignored');
      });
    },
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `https://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;

  const t = await owner.tenant.create({ data: { slug: `hooks-${run}`, name: 'Hooks' } });
  tenantId = t.id;
  service = new WebhookDeliveryService(appRole, env());
  strict = new WebhookDeliveryService(appRole, env({ WEBHOOK_ALLOW_PRIVATE_HOSTS: 'false' }));
});

afterAll(async () => {
  server?.close();
  await owner.webhookDelivery.deleteMany({ where: { tenantId } });
  await owner.webhookEndpoint.deleteMany({ where: { tenantId } });
  await owner.tenant.deleteMany({ where: { id: tenantId } });
  await owner.$disconnect();
  await appRole.$disconnect();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
});

async function endpoint(url = baseUrl) {
  const id = randomUUID();
  const row = await owner.webhookEndpoint.create({
    data: {
      id,
      tenantId,
      name: `hook-${id.slice(0, 4)}`,
      url,
      events: ['employee.created'],
      secretEnc: box.encrypt(SECRET, `webhook-secret:${tenantId}:${id}`),
      createdByUserId: (await owner.user.create({ data: { email: `u-${id}@test.local`, displayName: 'u' } }))
        .id,
    },
  });
  return row;
}

async function queue(endpointId: string) {
  const eventId = randomUUID();
  return owner.webhookDelivery.create({
    data: {
      tenantId,
      endpointId,
      eventId,
      eventType: 'employee.created',
      payload: { id: eventId, type: 'employee.created', data: { employeeCode: 'EMP-1' } },
    },
  });
}

const mine = (id: string) => owner.webhookDelivery.findUniqueOrThrow({ where: { id } });
const due = (id: string) =>
  owner.webhookDelivery.update({ where: { id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });

describe('signing', () => {
  it('is HMAC-SHA256 over id, timestamp and body', () => {
    const expected = createHmac('sha256', 'k').update('evt.100.{"a":1}').digest('hex');
    expect(signWebhook('k', 'evt', 100, '{"a":1}')).toBe(`v1,${expected}`);
  });
});

describe('delivery', () => {
  it('sends a signed request, then marks it sent and drops the payload', async () => {
    const ep = await endpoint();
    const d = await queue(ep.id);
    seen.length = 0;
    answer = 200;
    await service.sweep();
    const hit = seen.find((s) => s.headers['webhook-id'] === d.eventId)!;
    expect(hit).toBeDefined();
    expect(hit.headers['content-type']).toBe('application/json');
    const timestamp = Number(hit.headers['webhook-timestamp']);
    expect(Math.abs(Date.now() / 1000 - timestamp)).toBeLessThan(60);
    expect(hit.headers['webhook-signature']).toBe(signWebhook(SECRET, d.eventId, timestamp, hit.body));
    expect(JSON.parse(hit.body)).toMatchObject({ type: 'employee.created', data: { employeeCode: 'EMP-1' } });

    const after = await mine(d.id);
    expect(after).toMatchObject({ status: 'SENT', attempts: 1, lastStatusCode: 200 });
    expect(after.deliveredAt).not.toBeNull();
    expect(after.payload).toEqual({});
  });

  it('retries a failure later, not at once, and gives up after the allowed attempts', async () => {
    const ep = await endpoint();
    const d = await queue(ep.id);
    answer = 500;
    await service.sweep();
    let row = await mine(d.id);
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1, lastStatusCode: 500 });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
    expect(row.lastError).toBe('The receiver answered 500');

    // Not due yet: another sweep leaves it alone.
    seen.length = 0;
    await service.sweep();
    expect(seen.filter((s) => s.headers['webhook-id'] === d.eventId)).toHaveLength(0);
    expect((await mine(d.id)).attempts).toBe(1);

    await due(d.id);
    await service.sweep();
    await due(d.id);
    await service.sweep();
    row = await mine(d.id);
    expect(row).toMatchObject({ status: 'FAILED', attempts: 3 });
    expect(row.payload).not.toEqual({});
  });

  it('succeeds on a later try once the receiver recovers', async () => {
    const ep = await endpoint();
    const d = await queue(ep.id);
    answer = 503;
    await service.sweep();
    answer = 200;
    await due(d.id);
    await service.sweep();
    expect(await mine(d.id)).toMatchObject({ status: 'SENT', attempts: 2 });
  });

  it('switches an endpoint off after repeated failures, and stops sending to it', async () => {
    const ep = await endpoint();
    answer = 500;
    for (let i = 0; i < 2; i++) {
      const d = await queue(ep.id);
      for (let attempt = 0; attempt < 3; attempt++) {
        await due(d.id);
        await service.sweep();
      }
      expect((await mine(d.id)).status).toBe('FAILED');
    }
    expect(await owner.webhookEndpoint.findUniqueOrThrow({ where: { id: ep.id } })).toMatchObject({
      status: 'DISABLED',
      failureStreak: 2,
    });
    const waiting = await queue(ep.id);
    seen.length = 0;
    await service.sweep();
    expect(seen.filter((s) => s.headers['webhook-id'] === waiting.eventId)).toHaveLength(0);
    expect((await mine(waiting.id)).attempts).toBe(0);
  });

  it('refuses private addresses unless development mode allows them, without contacting them', async () => {
    const ep = await endpoint();
    const d = await queue(ep.id);
    answer = 200;
    seen.length = 0;
    await strict.sweep();
    expect(seen.filter((s) => s.headers['webhook-id'] === d.eventId)).toHaveLength(0);
    const row = await mine(d.id);
    expect(row.status).toBe('PENDING');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain('not allowed');
  });

  it('checks the address a name resolves to, not just the name', async () => {
    const ep = await endpoint(baseUrl.replace('127.0.0.1', 'localhost'));
    const d = await queue(ep.id);
    seen.length = 0;
    await strict.sweep();
    expect(seen.filter((s) => s.headers['webhook-id'] === d.eventId)).toHaveLength(0);
    expect((await mine(d.id)).lastError).toContain('not allowed');
  });

  it('cannot read a secret that was sealed for another endpoint', async () => {
    const ep = await endpoint();
    const other = await endpoint();
    await owner.webhookEndpoint.update({ where: { id: ep.id }, data: { secretEnc: other.secretEnc } });
    const d = await queue(ep.id);
    seen.length = 0;
    await service.sweep();
    expect(seen.filter((s) => s.headers['webhook-id'] === d.eventId)).toHaveLength(0);
    expect((await mine(d.id)).status).toBe('PENDING');
  });
});

describe('configuration', () => {
  it('will not start with private addresses allowed in production', () => {
    expect(() =>
      loadWorkerEnv({ ...process.env, NODE_ENV: 'production', WEBHOOK_ALLOW_PRIVATE_HOSTS: 'true' }),
    ).toThrow();
  });
});
