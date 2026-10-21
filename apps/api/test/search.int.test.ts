/**
 * Search through the real API and database: one box finds people, projects, work items, assets and stock, and
 * each person sees only the groups and records their own role already opens.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import { Browser, Fixtures, ownerClient, startApp, testEnv } from './helpers.js';

const db = ownerClient();
const fx = new Fixtures(db);
let app: NestExpressApplication;
let tenantId: string;
let owner: Browser;
let acme: string;
let projectsOnly: Browser;
let nobody: Browser;
const year = new Date().getUTCFullYear();

async function member(label: string, permissions?: string[]): Promise<Browser> {
  const user = await fx.user(label);
  const m = await fx.member(tenantId, user.id);
  if (permissions) {
    await fx.assign(tenantId, m.id, await fx.customRole(tenantId, label, permissions), {
      type: 'TENANT',
      id: tenantId,
    });
  }
  const browser = new Browser(app);
  expect((await browser.login(user.email)).status).toBe(200);
  return browser;
}

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  const tenant = await fx.tenant('Search');
  tenantId = tenant.id;
  const ownerUser = await fx.user('search-owner');
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  acme = (await fx.company(tenantId, 'ACME')).id;

  const emp = await owner.send('post', '/v1/employees', {
    firstName: 'Zebra',
    lastName: 'Walker',
    companyId: acme,
    dateOfJoining: `${year - 1}-01-01`,
  });
  expect(emp.status, JSON.stringify(emp.body)).toBe(201);
  const project = await owner.send('post', '/v1/projects', {
    companyId: acme,
    code: 'zb-1',
    name: 'Zebra rebuild',
    hourlyRate: 1000,
    budgetHours: 10,
  });
  expect(project.status, JSON.stringify(project.body)).toBe(201);
  const asset = await owner.send('post', '/v1/assets', {
    companyId: acme,
    tag: 'ZB-LAP-1',
    name: 'Zebra laptop',
    category: 'IT equipment',
    purchaseDate: `${year - 1}-01-01`,
    purchaseCost: 60000,
    salvageValue: 6000,
    usefulLifeMonths: 36,
  });
  expect(asset.status, JSON.stringify(asset.body)).toBe(201);
  const stock = await owner.send('post', '/v1/inventory/items', {
    sku: 'ZB-BOX',
    name: 'Zebra crate',
    unit: 'pcs',
  });
  expect(stock.status, JSON.stringify(stock.body)).toBe(201);
  const ws = await owner.send('post', '/v1/operations/workspaces', {
    companyId: acme,
    code: 'zb-help',
    name: 'Help desk',
    template: 'service_requests',
  });
  expect(ws.status, JSON.stringify(ws.body)).toBe(201);
  const item = await owner.send('post', `/v1/operations/workspaces/${ws.body.id}/items`, {
    title: 'Zebra incident',
    values: { category: 'Facilities' },
  });
  expect(item.status, JSON.stringify(item.body)).toBe(201);

  projectsOnly = await member('search-projects', ['projects.view']);
  nobody = await member('search-nobody');
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await db.$disconnect();
});

const kinds = (body: unknown) => (body as { kind: string }[]).map((h) => h.kind).sort();

describe('search', () => {
  it('finds each kind of record from one search, with where to open it', async () => {
    const res = await owner.get('/v1/search?q=zebra');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(kinds(res.body)).toEqual(['asset', 'inventory_item', 'ops_item', 'person', 'project']);
    const project = (res.body as { kind: string; href: string; subtitle: string }[]).find(
      (h) => h.kind === 'project',
    )!;
    expect(project.subtitle).toBe('ZB-1');
    expect(project.href).toMatch(/^\/projects\/[0-9a-f-]{36}$/);
  });

  it('matches codes as well as names', async () => {
    const res = await owner.get('/v1/search?q=zb-box');
    expect(kinds(res.body)).toEqual(['inventory_item']);
  });

  it('shows a person only the groups their role already opens', async () => {
    const res = await projectsOnly.get('/v1/search?q=zebra');
    expect(res.status).toBe(200);
    expect(kinds(res.body)).toEqual(['project']);
  });

  it('shows someone with no access nothing, and ignores one-letter searches', async () => {
    expect((await nobody.get('/v1/search?q=zebra')).body).toEqual([]);
    expect((await owner.get('/v1/search?q=z')).body).toEqual([]);
    expect((await owner.get('/v1/search')).body).toEqual([]);
  });

  it('needs a signed-in person', async () => {
    const anonymous = new Browser(app);
    expect((await anonymous.get('/v1/search?q=zebra')).status).toBe(401);
  });
});
