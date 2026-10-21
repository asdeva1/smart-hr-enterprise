/**
 * A manual performance baseline, skipped unless PERF=1 (PERF_EMPLOYEES sets the size, default 3000).
 * Seeds one organisation directly in the database, then times the endpoints people use most, as a signed-in
 * administrator through the real API. Prints a table; asserts only generous ceilings, so it catches a
 * collapse, not a slow day. Run: PERF=1 pnpm exec vitest run --project integration test/perf.manual.int.test.ts
 */
import { writeFileSync } from 'node:fs';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import { Browser, Fixtures, ownerClient, startApp, testEnv } from './helpers.js';

const enabled = process.env.PERF === '1';
const SIZE = Number(process.env.PERF_EMPLOYEES ?? 3000);
const db = ownerClient();
const fx = new Fixtures(db);
let app: NestExpressApplication;
let owner: Browser;
let tenantId: string;
const rows: { endpoint: string; p50: number; p95: number; max: number }[] = [];

beforeAll(async () => {
  if (!enabled) return;
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  const tenant = await fx.tenant('Perf');
  tenantId = tenant.id;
  const user = await fx.user('perf-owner');
  await fx.member(tenantId, user.id, true);
  const company = await fx.company(tenantId, 'PERF');
  owner = new Browser(app);
  expect((await owner.login(user.email)).status).toBe(200);
  const first = ['Asha', 'Ravi', 'Meera', 'Kiran', 'Divya', 'Suresh', 'Anita', 'Vikram', 'Lakshmi', 'Imran'];
  const last = ['Iyer', 'Reddy', 'Khan', 'Nair', 'Sharma', 'Das', 'Patel', 'Rao', 'Singh', 'Menon'];
  await db.employee.createMany({
    data: Array.from({ length: SIZE }, (_, i) => ({
      tenantId,
      companyId: company.id,
      employeeCode: `P-${String(i + 1).padStart(5, '0')}`,
      firstName: first[i % 10]!,
      lastName: `${last[Math.floor(i / 10) % 10]!}${i}`,
      workEmail: `p${i}@perf.test`,
      dateOfJoining: new Date('2024-01-01T00:00:00Z'),
    })),
  });
}, 120_000);

afterAll(async () => {
  if (enabled) {
    const text = rows
      .map(
        (r) =>
          `${r.endpoint.padEnd(70)} p50 ${String(r.p50).padStart(5)} ms   p95 ${String(r.p95).padStart(5)} ms   max ${String(r.max).padStart(5)} ms`,
      )
      .join('\n');
    process.stderr.write(`\n${text}\n`);
    if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, `${text}\n`);
    await app?.close();
    await fx.cleanup();
  }
  await db.$disconnect();
}, 120_000);

async function time(label: string, path: string, runs = 30) {
  const ms: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const res = await owner.get(path);
    ms.push(performance.now() - start);
    expect(res.status, `${label}: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(200);
  }
  ms.sort((a, b) => a - b);
  const at = (q: number) => Math.round(ms[Math.min(ms.length - 1, Math.floor(q * ms.length))]!);
  rows.push({
    endpoint: `${label} (${SIZE} people)`,
    p50: at(0.5),
    p95: at(0.95),
    max: Math.round(ms.at(-1)!),
  });
  return at(0.95);
}

describe.skipIf(!enabled)('baseline', () => {
  it('employee list, first page', async () => {
    expect(await time('GET /v1/employees', '/v1/employees?pageSize=50')).toBeLessThan(1500);
  });
  it('employee list, searched', async () => {
    expect(await time('GET /v1/employees?search=', '/v1/employees?search=reddy&pageSize=50')).toBeLessThan(
      1500,
    );
  });
  it('global search', async () => {
    expect(await time('GET /v1/search', '/v1/search?q=reddy')).toBeLessThan(2000);
  });
  it('home page', async () => {
    expect(await time('GET /v1/me/home', '/v1/me/home')).toBeLessThan(2000);
  });
  it('organisation chart', async () => {
    expect(await time('GET /v1/employees/org-chart', '/v1/employees/org-chart', 10)).toBeLessThan(5000);
  });
  it('directory read with an API key', async () => {
    const key = await owner.send('post', '/v1/integrations/api-keys', {
      name: 'perf',
      scopes: ['employees.read'],
    });
    const { default: request } = await import('supertest');
    const ms: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      const res = await request(app.getHttpServer())
        .get('/v1/integrations/api/employees?pageSize=200')
        .set('Authorization', `Bearer ${key.body.key as string}`);
      ms.push(performance.now() - start);
      expect(res.status).toBe(200);
    }
    ms.sort((a, b) => a - b);
    rows.push({
      endpoint: `GET /v1/integrations/api/employees (200/page, ${SIZE} people)`,
      p50: Math.round(ms[10]!),
      p95: Math.round(ms[19]!),
      max: Math.round(ms[19]!),
    });
    expect(ms[19]!).toBeLessThan(2000);
  });
});
