/**
 * The dashboard overview through the real API and database: money, people and project figures add up, the things
 * that need attention are listed, and a member sees only the areas their permissions and plan allow.
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
let plain: Browser;
let companyId: string;

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  const tenant = await fx.tenant('Overview');
  tenantId = tenant.id;
  const ownerUser = await fx.user('ov-owner');
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  companyId = (await fx.company(tenantId, 'OVC')).id;
  const plainUser = await fx.user('ov-plain');
  await fx.member(tenantId, plainUser.id);
  plain = new Browser(app);
  expect((await plain.login(plainUser.email)).status).toBe(200);
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await db.$disconnect();
});

describe('the dashboard overview', () => {
  it('is empty but valid for a new organisation', async () => {
    const res = await owner.get('/v1/me/overview');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.hr).toMatchObject({ headcount: 0, joinedByMonth: expect.any(Array) });
    expect(res.body.hr.joinedByMonth).toHaveLength(6);
    expect(res.body.finance).toMatchObject({ receivables: 0, payables: 0, overdueInvoices: 0 });
    expect(res.body.projects).toMatchObject({ active: 0, overBudget: 0 });
    expect(res.body.alerts).toEqual([]);
  });

  it('counts people, receivables, overdue items and projects over budget', async () => {
    const emp = await owner.send('post', '/v1/employees', {
      firstName: 'Ov',
      lastName: 'One',
      companyId,
      dateOfJoining: new Date().toISOString().slice(0, 10),
    });
    expect(emp.status, JSON.stringify(emp.body)).toBe(201);

    const S = '/v1/finance/sales';
    await owner.send('put', `${S}/settings/${companyId}`, { gstin: '27AAPFU0939F1ZV' });
    const customer = await owner.send('post', `${S}/customers`, {
      name: 'Northwind',
      gstin: '27AAPFU0939F1ZV',
    });
    const invoice = await owner.send('post', `${S}/documents`, {
      companyId,
      customerId: customer.body.id,
      type: 'INVOICE',
      date: '2026-01-10',
      dueDate: '2026-01-20',
      lines: [{ description: 'Work', hsn: '998314', quantity: 1, rate: 1000, gstRate: 18 }],
    });
    expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);
    expect((await owner.send('post', `${S}/documents/${invoice.body.id}/issue`)).status).toBe(200);

    const project = await owner.send('post', '/v1/projects', {
      companyId,
      code: 'OV1',
      name: 'Tiny budget',
      budgetHours: 1,
    });
    expect(project.status, JSON.stringify(project.body)).toBe(201);
    const me = await db.employee.findFirstOrThrow({ where: { tenantId } });
    const row = await db.project.findFirstOrThrow({ where: { tenantId, code: 'OV1' } });
    await db.timeEntry.create({
      data: {
        tenantId,
        projectId: row.id,
        employeeId: me.id,
        workDate: new Date('2026-01-12'),
        minutes: 150,
      },
    });

    const res = await owner.get('/v1/me/overview');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.hr.headcount).toBe(1);
    expect(res.body.hr.joinedLast30).toBe(1);
    expect(res.body.finance.receivables).toBe(1180);
    expect(res.body.finance.overdueInvoices).toBe(1);
    expect(res.body.finance.overdueReceivables).toBe(1180);
    expect(res.body.projects).toMatchObject({ active: 1, overBudget: 1, timeToApproveHours: 2.5 });
    expect(res.body.projects.busiest[0]).toMatchObject({ code: 'OV1', percent: 250 });
    const ids = (res.body.alerts as { id: string; tone: string }[]).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['fin-overdue-invoices', 'proj-over', 'proj-time']));
    // Most urgent first.
    const tones = (res.body.alerts as { tone: string }[]).map((a) => a.tone);
    expect(tones).toEqual(
      [...tones].sort(
        (a, b) => ['danger', 'warning', 'info'].indexOf(a) - ['danger', 'warning', 'info'].indexOf(b),
      ),
    );
  });

  it('shows a member with no permissions none of the areas', async () => {
    const res = await plain.get('/v1/me/overview');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hr: null, finance: null, projects: null, alerts: [] });
  });

  it('leaves out an area the plan does not include', async () => {
    const tenant = await fx.tenant('OverviewLite', 'ACTIVE', { plan: 'LITE' });
    const user = await fx.user('ovlite-owner');
    await fx.member(tenant.id, user.id, true);
    const b = new Browser(app);
    expect((await b.login(user.email)).status).toBe(200);
    const res = await b.get('/v1/me/overview');
    expect(res.status).toBe(200);
    expect(res.body.finance).toBeNull();
    expect(res.body.projects).toBeNull();
    expect(res.body.hr).not.toBeNull();
  });
});
