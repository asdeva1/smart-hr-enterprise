/**
 * The asset register through the real API and database: adding assets, giving them out and taking them back
 * with history, one holder at a time, retiring, depreciation on read, who can see what, and the plan gate.
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
const year = new Date().getUTCFullYear();
const today = new Date().toISOString().slice(0, 10);

interface Person {
  employeeId: string;
  browser: Browser;
}

async function person(label: string, permissions?: string[]): Promise<Person> {
  const user = await fx.user(label);
  const m = await fx.member(tenantId, user.id);
  if (permissions) {
    await fx.assign(tenantId, m.id, await fx.customRole(tenantId, label, permissions), {
      type: 'TENANT',
      id: tenantId,
    });
  }
  const res = await owner.send('post', '/v1/employees', {
    firstName: label,
    lastName: 'Test',
    companyId: acme,
    dateOfJoining: `${year - 1}-01-01`,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await db.employee.update({ where: { id: res.body.id }, data: { membershipId: m.id } });
  const browser = new Browser(app);
  expect((await browser.login(user.email)).status).toBe(200);
  return { employeeId: res.body.id as string, browser };
}

let keeper: Person;
let auditor: Person;
let ravi: Person;
let meera: Person;

const body = (tag: string, extra: Record<string, unknown> = {}) => ({
  companyId: acme,
  tag,
  name: 'Laptop',
  category: 'IT equipment',
  serialNumber: `SN-${tag}`,
  purchaseDate: `${year - 1}-01-01`,
  purchaseCost: 60000,
  salvageValue: 6000,
  usefulLifeMonths: 36,
  ...extra,
});

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  const tenant = await fx.tenant('Assets');
  tenantId = tenant.id;
  const ownerUser = await fx.user('asset-owner');
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  acme = (await fx.company(tenantId, 'ACME')).id;
  keeper = await person('asset-keeper', ['assets.view', 'assets.manage']);
  auditor = await person('asset-auditor', ['assets.view']);
  ravi = await person('asset-ravi');
  meera = await person('asset-meera');
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await db.$disconnect();
});

describe('assets', () => {
  let id: string;

  it('are added by assets.manage, with checked values and unique tags', async () => {
    expect((await ravi.browser.send('post', '/v1/assets', body('LAP-1'))).status).toBe(403);
    expect((await auditor.browser.send('post', '/v1/assets', body('LAP-1'))).status).toBe(403);
    expect(
      (await keeper.browser.send('post', '/v1/assets', body('LAP-1', { salvageValue: 70000 }))).status,
    ).toBe(400);
    const res = await keeper.browser.send('post', '/v1/assets', body('lap-1'));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    id = res.body.id;
    expect(res.body.tag).toBe('LAP-1');
    expect(res.body.status).toBe('IN_STOCK');
    expect((await keeper.browser.send('post', '/v1/assets', body('LAP-1'))).status).toBe(400);
  });

  it('show depreciation worked out to today', async () => {
    const res = await keeper.browser.get(`/v1/assets/${id}`);
    expect(res.status).toBe(200);
    const d = res.body.depreciation;
    expect(d.monthlyCharge).toBe(1500);
    expect(d.accumulated).toBe(1500 * d.monthsElapsed);
    expect(d.bookValue).toBe(60000 - d.accumulated);
    expect(d.monthsElapsed).toBeGreaterThanOrEqual(12);
  });

  it('are visible to viewers but not to others', async () => {
    expect((await auditor.browser.get(`/v1/assets/${id}`)).status).toBe(200);
    expect((await auditor.browser.get('/v1/assets')).body).toHaveLength(1);
    expect((await ravi.browser.get('/v1/assets')).status).toBe(403);
    expect((await ravi.browser.get(`/v1/assets/${id}`)).status).toBe(403);
  });

  it('are given to people found through a narrow employee search', async () => {
    const found = await keeper.browser.get('/v1/assets/people?search=asset-rav');
    expect(found.body).toHaveLength(1);
    expect(Object.keys((found.body as object[])[0]!).sort()).toEqual(['code', 'id', 'name']);
    expect((await ravi.browser.get('/v1/assets/people')).status).toBe(403);
  });

  it('are given to one person at a time, with history', async () => {
    const given = await keeper.browser.send('post', `/v1/assets/${id}/assign`, {
      employeeId: ravi.employeeId,
      condition: 'New',
    });
    expect(given.status, JSON.stringify(given.body)).toBe(201);
    expect(given.body.status).toBe('ASSIGNED');
    expect((await keeper.browser.get('/v1/assets')).body[0].holder.id).toBe(ravi.employeeId);
    expect((await ravi.browser.get('/v1/assets/mine')).body).toHaveLength(1);
    expect((await meera.browser.get('/v1/assets/mine')).body).toHaveLength(0);

    const second = await keeper.browser.send('post', `/v1/assets/${id}/assign`, {
      employeeId: meera.employeeId,
    });
    expect(second.status).toBe(409);
    expect((await keeper.browser.send('patch', `/v1/assets/${id}`, { status: 'UNDER_REPAIR' })).status).toBe(
      409,
    );
    expect(
      (await keeper.browser.send('post', `/v1/assets/${id}/retire`, { reason: 'Old and broken' })).status,
    ).toBe(409);
  });

  it('come back, can go for repair, and are given out again', async () => {
    const back = await keeper.browser.send('post', `/v1/assets/${id}/return`, {
      condition: 'Screen cracked',
      needsRepair: true,
    });
    expect(back.status, JSON.stringify(back.body)).toBe(201);
    expect(back.body.status).toBe('UNDER_REPAIR');
    expect((await ravi.browser.get('/v1/assets/mine')).body).toHaveLength(0);
    expect(
      (await keeper.browser.send('post', `/v1/assets/${id}/assign`, { employeeId: meera.employeeId })).status,
    ).toBe(409);
    expect((await keeper.browser.send('post', `/v1/assets/${id}/return`, {})).status).toBe(409);

    await keeper.browser.send('patch', `/v1/assets/${id}`, { status: 'IN_STOCK', notes: 'Screen replaced' });
    const again = await keeper.browser.send('post', `/v1/assets/${id}/assign`, {
      employeeId: meera.employeeId,
    });
    expect(again.body.status).toBe('ASSIGNED');

    const detail = await keeper.browser.get(`/v1/assets/${id}`);
    expect(detail.body.history).toHaveLength(2);
    const closed = (detail.body.history as { returnedOn: string | null; conditionIn: string | null }[]).find(
      (h) => h.returnedOn,
    );
    expect(closed?.conditionIn).toBe('Screen cracked');
  });

  it('can be retired once returned, and then stop depreciating and stay fixed', async () => {
    await keeper.browser.send('post', `/v1/assets/${id}/return`, {});
    const retired = await keeper.browser.send('post', `/v1/assets/${id}/retire`, {
      reason: 'Beyond repair',
      retiredOn: today,
    });
    expect(retired.status, JSON.stringify(retired.body)).toBe(201);
    expect(retired.body.status).toBe('RETIRED');
    expect(retired.body.retireReason).toBe('Beyond repair');
    expect((await keeper.browser.send('patch', `/v1/assets/${id}`, { name: 'Renamed' })).status).toBe(409);
    expect(
      (await keeper.browser.send('post', `/v1/assets/${id}/assign`, { employeeId: ravi.employeeId })).status,
    ).toBe(409);
  });

  it('cannot be given out before they were bought, or to someone who has left', async () => {
    const res = await keeper.browser.send('post', '/v1/assets', body('LAP-2', { purchaseDate: today }));
    const early = await keeper.browser.send('post', `/v1/assets/${res.body.id}/assign`, {
      employeeId: ravi.employeeId,
      assignedOn: `${year - 1}-01-01`,
    });
    expect(early.status).toBe(400);
    await db.employee.update({ where: { id: meera.employeeId }, data: { status: 'EXITED' } });
    const gone = await keeper.browser.send('post', `/v1/assets/${res.body.id}/assign`, {
      employeeId: meera.employeeId,
    });
    expect(gone.status).toBe(400);
  });

  it('are protected by the database as well: one open assignment per asset', async () => {
    const res = await keeper.browser.send('post', '/v1/assets', body('LAP-3'));
    await keeper.browser.send('post', `/v1/assets/${res.body.id}/assign`, { employeeId: ravi.employeeId });
    await expect(
      db.assetAssignment.create({
        data: {
          tenantId,
          assetId: res.body.id,
          employeeId: ravi.employeeId,
          assignedOn: new Date(),
          assignedByUserId: (await db.user.findFirstOrThrow()).id,
        },
      }),
    ).rejects.toThrow();
  });
});

describe('plan gate', () => {
  it('hides assets from an organisation whose plan lacks them', async () => {
    const lite = await fx.tenant('AssetsLite', 'ACTIVE', { plan: 'LITE' });
    const user = await fx.user('asset-lite');
    await fx.member(lite.id, user.id, true);
    const b = new Browser(app);
    await b.login(user.email);
    expect((await b.get('/v1/assets')).status).toBe(403);
  });
});
