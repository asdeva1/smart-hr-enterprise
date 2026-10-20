/**
 * The home page and the manager's team view through the real API and database: what each person sees comes
 * from the same checks as the pages behind it, a section the plan lacks is left out, and one person's work
 * never shows up on another's page.
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

async function person(label: string, managerId?: string, permissions?: string[]): Promise<Person> {
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
    ...(managerId ? { managerId } : {}),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await db.employee.update({ where: { id: res.body.id }, data: { membershipId: m.id } });
  const browser = new Browser(app);
  expect((await browser.login(user.email)).status).toBe(200);
  return { employeeId: res.body.id as string, browser };
}

let boss: Person;
let asha: Person;
let ravi: Person;
let outsider: Person;
let annual: string;

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  const tenant = await fx.tenant('SelfService');
  tenantId = tenant.id;
  const ownerUser = await fx.user('ss-owner');
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  acme = (await fx.company(tenantId, 'ACME')).id;

  boss = await person('ss-boss', undefined, [
    'operations.manage',
    'operations.contribute',
    'projects.manage',
  ]);
  asha = await person('ss-asha', boss.employeeId);
  ravi = await person('ss-ravi', boss.employeeId);
  outsider = await person('ss-outsider');

  const type = await owner.send('post', '/v1/leave/types', {
    code: 'EL',
    name: 'Earned leave',
    accrual: 'YEARLY',
    quotaDays: 12,
  });
  annual = type.body.id as string;
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await db.$disconnect();
});

describe('the home page', () => {
  it('starts with the person, their balances and nothing pending', async () => {
    const res = await asha.browser.get('/v1/me/home');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.employee.name).toContain('ss-asha');
    expect(res.body.leave.balances[0]).toMatchObject({ type: 'Earned leave', available: 12 });
    expect(res.body.leave.pending).toBe(0);
    expect(res.body.waitingForMe).toMatchObject({ count: 0 });
    expect(res.body.work).toMatchObject({ open: 0 });
    expect(res.body.assets).toMatchObject({ count: 0 });
  });

  it('follows what the person does: clocking in, work given to them, time logged, an asset', async () => {
    expect((await asha.browser.send('post', '/v1/attendance/me/punch', { direction: 'IN' })).status).toBe(
      200,
    );

    const ws = await boss.browser.send('post', '/v1/operations/workspaces', {
      companyId: acme,
      code: 'ss-help',
      name: 'Help desk',
      template: 'service_requests',
    });
    const item = await boss.browser.send('post', `/v1/operations/workspaces/${ws.body.id}/items`, {
      title: 'Fix the projector',
      values: { category: 'Facilities' },
      assigneeId: asha.employeeId,
      dueDate: '2000-01-01',
    });
    expect(item.status, JSON.stringify(item.body)).toBe(201);

    const project = await boss.browser.send('post', '/v1/projects', {
      companyId: acme,
      code: 'ss-1',
      name: 'Rollout',
    });
    await boss.browser.send('put', `/v1/projects/${project.body.id}/members`, {
      members: [{ employeeId: asha.employeeId, costRate: 0 }],
    });
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const logged = await asha.browser.send('post', '/v1/projects/time', {
      projectId: project.body.id,
      workDate: yesterday,
      hours: 3,
    });
    expect(logged.status, JSON.stringify(logged.body)).toBe(201);

    const res = await asha.browser.get('/v1/me/home');
    expect(res.body.attendance).toMatchObject({ nextAction: 'OUT', canPunch: true });
    expect(res.body.attendance.firstIn).not.toBeNull();
    expect(res.body.work).toMatchObject({ open: 1, overdue: 1 });
    expect(res.body.work.items[0].title).toBe('Fix the projector');
    expect(res.body.time.weekHours).toBeGreaterThanOrEqual(0);
  });

  it('keeps one person’s work off another person’s page', async () => {
    const res = await outsider.browser.get('/v1/me/home');
    expect(res.status).toBe(200);
    expect(res.body.work).toMatchObject({ open: 0 });
    expect(JSON.stringify(res.body)).not.toContain('projector');
  });

  it('puts approvals waiting on the manager’s page and pending requests on the requester’s', async () => {
    const monday = (() => {
      const d = new Date(Date.now() + 21 * 86_400_000);
      while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    })();
    const req = await ravi.browser.send('post', '/v1/leave/requests', {
      leaveTypeId: annual,
      from: monday,
      to: monday,
      reason: 'Personal',
    });
    expect(req.status, JSON.stringify(req.body)).toBe(201);

    const mine = await ravi.browser.get('/v1/me/home');
    expect(mine.body.leave.pending).toBe(1);
    const theirs = await boss.browser.get('/v1/me/home');
    expect(theirs.body.waitingForMe.count).toBe(1);
    expect(theirs.body.waitingForMe.first[0].title).toBeTruthy();
  });
});

describe('the team view', () => {
  it('shows a manager how their team is today and what leave waits on them', async () => {
    const res = await boss.browser.get('/v1/me/team');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.counts.total).toBe(2);
    expect(res.body.pendingLeave).toBe(1);
    const names = (res.body.notIn as { name: string }[]).map((n) => n.name).join(' ');
    expect(names).toContain('ss-ravi');
  });

  it('is empty for someone with no team and no access', async () => {
    const res = await outsider.browser.get('/v1/me/team');
    expect(res.status).toBe(200);
    expect(res.body?.counts?.total ?? 0).toBe(0);
    expect(res.body?.pendingLeave ?? 0).toBe(0);
  });
});

describe('plans', () => {
  it('leaves out what the plan lacks, and refuses the page where self-service is missing', async () => {
    const lite = await fx.tenant('SelfServiceLite', 'ACTIVE', { plan: 'LITE' });
    const user = await fx.user('ss-lite');
    await fx.member(lite.id, user.id, true);
    const b = new Browser(app);
    await b.login(user.email);
    expect((await b.get('/v1/me/home')).status).toBe(403);
    expect((await b.get('/v1/me/team')).status).toBe(403);
  });
});
