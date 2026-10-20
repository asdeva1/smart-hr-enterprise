/**
 * Projects and timesheets through the real API and database: who can log time, the 24 hour day limit (also
 * under concurrent requests), approval by the project manager and the lock on approved time, exact
 * profitability, visibility and the plan gate.
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

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

let finance: Person;
let lead: Person;
let ravi: Person;
let asha: Person;
let stranger: Person;
let projectId: string;

const log = (p: Person, hours: number, date = day(-1), extra: object = {}) =>
  p.browser.send('post', '/v1/projects/time', { projectId, workDate: date, hours, ...extra });

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  const tenant = await fx.tenant('Projects');
  tenantId = tenant.id;
  const ownerUser = await fx.user('prj-owner');
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  acme = (await fx.company(tenantId, 'ACME')).id;

  finance = await person('prj-finance', ['projects.view', 'projects.manage']);
  lead = await person('prj-lead');
  ravi = await person('prj-ravi');
  asha = await person('prj-asha');
  stranger = await person('prj-stranger');
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await db.$disconnect();
});

describe('setting up a project', () => {
  it('lets a project manager create a project and choose its team, and nobody else', async () => {
    const body = {
      companyId: acme,
      code: 'web-1',
      name: 'Website rebuild',
      clientName: 'Globex',
      hourlyRate: 1000,
      budgetHours: 30,
      managerId: lead.employeeId,
    };
    expect((await ravi.browser.send('post', '/v1/projects', body)).status).toBe(403);
    const created = await finance.browser.send('post', '/v1/projects', body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.code).toBe('WEB-1');
    projectId = created.body.id as string;
    expect((await finance.browser.send('post', '/v1/projects', body)).status).toBe(400);

    const members = await finance.browser.send('put', `/v1/projects/${projectId}/members`, {
      members: [
        { employeeId: ravi.employeeId, costRate: 300 },
        { employeeId: asha.employeeId, costRate: 500 },
        { employeeId: lead.employeeId, costRate: 600 },
      ],
    });
    expect(members.status, JSON.stringify(members.body)).toBe(200);
    expect(
      (await ravi.browser.send('put', `/v1/projects/${projectId}/members`, { members: [] })).status,
    ).toBe(403);
  });

  it('shows team members only the projects they are on', async () => {
    const mine = await ravi.browser.get('/v1/projects/mine');
    expect((mine.body as { id: string }[]).map((p) => p.id)).toEqual([projectId]);
    expect((await stranger.browser.get('/v1/projects/mine')).body).toEqual([]);
  });
});

describe('logging time', () => {
  it('lets a member log hours, and refuses non-members, the future and a project that is not active', async () => {
    const ok = await log(ravi, 4);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.hours).toBe(4);
    expect((await log(stranger, 1)).status).toBe(400);
    expect((await log(ravi, 1, day(3))).status).toBe(400);
    expect((await log(ravi, 25)).status).toBe(400);
  });

  it('stops a day going over 24 hours', async () => {
    expect((await log(ravi, 20)).status).toBe(201);
    const over = await log(ravi, 0.5);
    expect(over.status).toBe(409);
    expect(over.body.code).toBe('DAY_TOO_LONG');
  });

  it('holds the limit under concurrent requests', async () => {
    const date = day(-2);
    const results = await Promise.all(Array.from({ length: 6 }, () => log(asha, 5, date)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(4);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    const range = await asha.browser.get(`/v1/projects/time?from=${date}&to=${date}`);
    expect(range.body.totalHours).toBe(20);
  });

  it('lets people correct their own open time and nobody else’s', async () => {
    const entry = await log(ravi, 1, day(-3));
    const id = entry.body.id as string;
    const fixed = await ravi.browser.send('patch', `/v1/projects/time/${id}`, { hours: 2.5, note: 'Design' });
    expect(fixed.status).toBe(200);
    expect(fixed.body.hours).toBe(2.5);
    expect((await asha.browser.send('patch', `/v1/projects/time/${id}`, { hours: 1 })).status).toBe(404);
    expect((await asha.browser.send('delete', `/v1/projects/time/${id}`)).status).toBe(404);
    expect((await ravi.browser.send('delete', `/v1/projects/time/${id}`)).status).toBe(200);
  });
});

describe('approval', () => {
  it('lets the project manager approve the team’s time, and locks it', async () => {
    const day1 = day(-1);
    expect(
      (await stranger.browser.send('post', '/v1/projects/time/approve', { projectId, from: day1, to: day1 }))
        .status,
    ).toBe(403);
    const done = await lead.browser.send('post', '/v1/projects/time/approve', {
      projectId,
      from: day(-10),
      to: day(0),
    });
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(done.body.approved).toBe(6);

    const mine = await ravi.browser.get(`/v1/projects/time?from=${day(-10)}&to=${day(0)}`);
    const entry = (mine.body.entries as { id: string; status: string }[])[0]!;
    expect(entry.status).toBe('APPROVED');
    const edit = await ravi.browser.send('patch', `/v1/projects/time/${entry.id}`, { hours: 1 });
    expect(edit.status).toBe(409);
    expect(edit.body.code).toBe('TIME_APPROVED');
    expect((await ravi.browser.send('delete', `/v1/projects/time/${entry.id}`)).status).toBe(409);
  });

  it('keeps a manager from approving their own hours, unless they manage projects organisation-wide', async () => {
    expect((await log(lead, 2, day(-4))).status).toBe(201);
    const own = await lead.browser.send('post', '/v1/projects/time/approve', {
      projectId,
      from: day(-10),
      to: day(0),
    });
    expect(own.body.approved).toBe(0);
    const all = await finance.browser.send('post', '/v1/projects/time/approve', {
      projectId,
      from: day(-10),
      to: day(0),
    });
    expect(all.body.approved).toBe(1);
  });
});

describe('visibility and profitability', () => {
  it('works out hours, revenue, cost and profit exactly for people who may see money', async () => {
    // ravi 24h on one day + asha 20h + lead 2h = 46h logged, all billable at 1000 an hour.
    const detail = await finance.browser.get(`/v1/projects/${projectId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.loggedHours).toBe(46);
    expect(detail.body.overBudget).toBe(true);
    expect(detail.body.money).toEqual({
      revenue: 46_000,
      // 24 × 300 + 20 × 500 + 2 × 600
      cost: 7200 + 10_000 + 1200,
      profit: 46_000 - 18_400,
    });
  });

  it('shows the project manager the project but not the money, and hides it from everyone else', async () => {
    const asLead = await lead.browser.get(`/v1/projects/${projectId}`);
    expect(asLead.status).toBe(200);
    expect(asLead.body.money).toBeNull();
    expect(
      (await lead.browser.get(`/v1/projects/${projectId}/time?from=${day(-10)}&to=${day(0)}`)).body,
    ).toHaveLength(7);
    expect((await ravi.browser.get(`/v1/projects/${projectId}`)).status).toBe(404);
    expect(
      (await stranger.browser.get(`/v1/projects/${projectId}/time?from=${day(-10)}&to=${day(0)}`)).status,
    ).toBe(404);
    expect(((await ravi.browser.get('/v1/projects')).body as unknown[]).length).toBe(0);
  });

  it('won’t remove someone from a project once they have logged time', async () => {
    const res = await finance.browser.send('put', `/v1/projects/${projectId}/members`, {
      members: [{ employeeId: asha.employeeId, costRate: 500 }],
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MEMBER_HAS_TIME');
  });

  it('stops time on a project that is no longer active', async () => {
    const closed = await finance.browser.send('patch', `/v1/projects/${projectId}`, { status: 'COMPLETED' });
    expect(closed.status).toBe(200);
    expect((await log(asha, 1, day(-5))).status).toBe(400);
    expect((await asha.browser.get('/v1/projects/mine')).body).toEqual([]);
  });
});

describe('plan gate', () => {
  it('hides projects from an organisation whose plan lacks them', async () => {
    const lite = await fx.tenant('ProjectsLite', 'ACTIVE', { plan: 'LITE' });
    const user = await fx.user('prj-lite');
    await fx.member(lite.id, user.id, true);
    const b = new Browser(app);
    await b.login(user.email);
    expect((await b.get('/v1/projects')).status).toBe(403);
  });
});
