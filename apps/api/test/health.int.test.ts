/**
 * Boots the real API against real PostgreSQL and Redis.
 * Requires DATABASE_URL and REDIS_URL (see .env.example).
 */
import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.factory.js';
import { loadApiEnv } from '../src/config/env.js';
import { MFA_KEY } from './helpers.js';

const baseEnv = {
  ...process.env,
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  CORS_ORIGINS: 'http://localhost:3000',
  MFA_ENCRYPTION_KEYS: `t1:${MFA_KEY}`,
  MFA_ENCRYPTION_KEY_ID: 't1',
};

describe('API with healthy dependencies', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createApp(loadApiEnv(baseEnv));
    await app.init();
  });
  afterAll(async () => app?.close());

  it('reports liveness without touching dependencies', async () => {
    const res = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('reports readiness when database and Redis answer', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('answers unknown routes with problem details', async () => {
    const res = await request(app.getHttpServer()).get('/nope').expect(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 404, code: 'NOT_FOUND', instance: '/nope' });
    expect(res.body.requestId).toBeTypeOf('string');
  });

  it('echoes a well-formed request id and replaces a malformed one', async () => {
    const kept = await request(app.getHttpServer())
      .get('/health/live')
      .set('x-request-id', 'lb-trace-12345678');
    expect(kept.headers['x-request-id']).toBe('lb-trace-12345678');

    const replaced = await request(app.getHttpServer()).get('/health/live').set('x-request-id', '<script>');
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sends security headers and hides the framework', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('allows only configured browser origins', async () => {
    const allowed = await request(app.getHttpServer())
      .get('/health/live')
      .set('Origin', 'http://localhost:3000');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');

    const blocked = await request(app.getHttpServer())
      .get('/health/live')
      .set('Origin', 'https://evil.example');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('publishes the OpenAPI document outside production', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json').expect(200);
    const doc = res.body as { info: { title: string }; paths: Record<string, unknown> };
    expect(doc.info.title).toBe('Smart HR Enterprise API');
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/health/live', '/health/ready']));
  });
});

describe('API with Redis unreachable', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createApp(loadApiEnv({ ...baseEnv, REDIS_URL: 'redis://127.0.0.1:6399' }));
    await app.init();
  });
  afterAll(async () => app?.close());

  it('stays alive but reports not ready', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200);
    const res = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(res.body).toEqual({ status: 'unavailable', checks: { database: 'up', redis: 'down' } });
  });
});

describe('API in production mode', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    // Production refuses insecure cookies, so pin it rather than inheriting a local developer setting.
    app = await createApp(loadApiEnv({ ...baseEnv, NODE_ENV: 'production', AUTH_COOKIE_SECURE: 'true' }));
    await app.init();
  });
  afterAll(async () => app?.close());

  it('does not publish API docs', async () => {
    await request(app.getHttpServer()).get('/docs-json').expect(404);
  });
});
