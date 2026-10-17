/**
 * Payroll through the real API and database: salaries with revisions, a month's run from salary and
 * attendance with Indian statutory deductions, approval by someone other than the preparer, final payslips
 * employees can see, the register, bank and PF files, and the database refusing changes to approved pay.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDatabaseClient, withTenant } from '@smart-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import {
  Browser,
  DEFAULT_PASSWORD,
  Fixtures,
  ownerClient,
  requireEnv,
  startApp,
  testEnv,
} from './helpers.js';

const db = ownerClient();
const runtime = createDatabaseClient({ connectionString: requireEnv('DATABASE_URL'), maxConnections: 2 });
const fx = new Fixtures(db);
let app: NestExpressApplication;
let tenantId: string;
let ownerId: string;
let owner: Browser;
let acme: string;

interface Person {
  employeeId: string;
  browser: Browser;
  userId: string;
}

async function person(label: string, dateOfJoining: string, permissions?: string[]): Promise<Person> {
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
    dateOfJoining,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await db.employee.update({ where: { id: res.body.id }, data: { membershipId: m.id } });
  const browser = new Browser(app);
  expect((await browser.login(user.email)).status).toBe(200);
  return { employeeId: res.body.id as string, browser, userId: user.id };
}

type Line = { code: string; amount: number };
type Slip = {
  employeeId: string;
  id: string;
  gross: number;
  net: number;
  deductions: Line[];
  employer: Line[];
  earnings: Line[];
  lopDays: number;
  paidDays: number;
  esiCovered: boolean;
};
const slipOf = (run: { payslips: Slip[] }, employeeId: string) =>
  run.payslips.find((p) => p.employeeId === employeeId)!;
const line = (lines: Line[], code: string) => lines.find((l) => l.code === code)?.amount ?? 0;

let payroll: Person;
let asha: Person;
let ravi: Person;
let components: Record<string, string>;

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  const tenant = await fx.tenant('Payroll');
  tenantId = tenant.id;
  const ownerUser = await fx.user('pay-owner');
  ownerId = ownerUser.id;
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  acme = (await fx.company(tenantId, 'ACME')).id;
  payroll = await person('pay-admin', '2024-01-01', [
    'org.view',
    'employees.view',
    'employees.sensitive.view',
    'payroll.view',
    'payroll.manage',
    'payroll.configure',
  ]);
  asha = await person('pay-asha', '2025-01-01');
  ravi = await person('pay-ravi', '2026-04-16');
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await runtime.$disconnect();
  await db.$disconnect();
});

describe('set-up', () => {
  it('starts with basic, HRA and special allowance, and takes salaries and statutory choices', async () => {
    const list = (await payroll.browser.get('/v1/payroll/components')).body as { id: string; code: string }[];
    expect(list.map((c) => c.code)).toEqual(['BASIC', 'HRA', 'SPECIAL']);
    components = Object.fromEntries(list.map((c) => [c.code, c.id]));
    expect((await asha.browser.get('/v1/payroll/components')).status).toBe(403);

    const salary = (employeeId: string, effectiveFrom: string, basic: number, hra: number, special: number) =>
      payroll.browser.send('post', `/v1/payroll/employees/${employeeId}/salaries`, {
        effectiveFrom,
        annualCtc: Math.round((basic + hra + special) * 12 * 1.1),
        lines: [
          { componentId: components.BASIC, monthly: basic },
          { componentId: components.HRA, monthly: hra },
          { componentId: components.SPECIAL, monthly: special },
        ],
      });
    expect((await salary(asha.employeeId, '2025-01-01', 30_000, 15_000, 15_000)).status).toBe(201);
    expect((await salary(ravi.employeeId, '2026-04-16', 9_000, 4_500, 4_500)).status).toBe(201);
    for (const e of [asha, ravi]) {
      const res = await payroll.browser.send('put', `/v1/payroll/employees/${e.employeeId}/profile`, {
        pfEnabled: true,
        esiEnabled: true,
        ptState: 'KA',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    // Bank details and UAN, as HR records them (recent password entry needed).
    await owner.send('post', '/v1/auth/reauthenticate', { password: DEFAULT_PASSWORD });
    const bank = await owner.send('put', `/v1/employees/${asha.employeeId}/sensitive`, {
      bankAccount: '123456789012',
      bankIfsc: 'HDFC0001234',
      bankName: 'HDFC Bank',
      uan: '100200300400',
    });
    expect(bank.status, JSON.stringify(bank.body)).toBe(200);

    const history = (await payroll.browser.get(`/v1/payroll/employees/${asha.employeeId}`)).body;
    expect(history.salaries[0]).toMatchObject({ monthlyGross: 60_000 });
    expect(history.profile).toMatchObject({ ptState: 'KA', pfEnabled: true });
    expect((await asha.browser.get(`/v1/payroll/employees/${asha.employeeId}`)).status).toBe(403);

    // A day and a half of absence in April for Asha.
    await db.attendanceDay.createMany({
      data: [
        { tenantId, employeeId: asha.employeeId, date: new Date('2026-04-08T00:00:00Z'), status: 'ABSENT' },
        { tenantId, employeeId: asha.employeeId, date: new Date('2026-04-09T00:00:00Z'), status: 'HALF_DAY' },
      ],
    });
  });
});

let april: { id: string; payslips: Slip[] };

describe('a month’s payroll', () => {
  it('is calculated from salaries, attendance and the statutory rules', async () => {
    const res = await payroll.browser.send('post', '/v1/payroll/runs', {
      companyId: acme,
      year: 2026,
      month: 4,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    april = res.body as typeof april;
    expect(res.body).toMatchObject({ status: 'DRAFT', employeeCount: 2, period: 'April 2026' });

    const a = slipOf(april, asha.employeeId);
    expect(a).toMatchObject({ lopDays: 1.5, paidDays: 28.5, gross: 57_000 });
    expect(line(a.earnings, 'BASIC')).toBe(28_500);
    expect(line(a.deductions, 'PF')).toBe(1_800); // 12% of the ₹15,000 ceiling
    expect(line(a.deductions, 'PT')).toBe(200);
    expect(line(a.deductions, 'TDS')).toBe(0); // projected ₹6.42 lakh: under the ₹12 lakh rebate
    expect(line(a.deductions, 'ESI')).toBe(0);
    expect(line(a.employer, 'EPS')).toBe(1_250);
    expect(a.net).toBe(55_000);

    // Ravi joined on the 16th: half a month, covered by ESI (₹18,000 a month is under ₹21,000).
    const r = slipOf(april, ravi.employeeId);
    expect(r).toMatchObject({ paidDays: 15, gross: 9_000, esiCovered: true });
    expect(line(r.deductions, 'ESI')).toBe(68);
    expect(line(r.employer, 'ESI_ER')).toBe(293);
    expect(line(r.deductions, 'PF')).toBe(540);
    expect(line(r.deductions, 'PT')).toBe(0);

    expect(
      (await payroll.browser.send('post', '/v1/payroll/runs', { companyId: acme, year: 2026, month: 4 })).body
        .code,
    ).toBe('RUN_EXISTS');
    expect((await asha.browser.get(`/v1/payroll/runs/${april.id}`)).status).toBe(404);
  });

  it('takes corrections while a draft: loss of pay by hand and one-off lines', async () => {
    const a = slipOf(april, asha.employeeId);
    const res = await payroll.browser.send('patch', `/v1/payroll/payslips/${a.id}`, {
      lopOverride: 1,
      adjustments: [{ name: 'Referral bonus', kind: 'EARNING', amount: 5_000, taxable: true }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = slipOf(res.body as typeof april, asha.employeeId);
    expect(after.lopDays).toBe(1);
    expect(after.gross).toBe(58_000 + 5_000);
    april = res.body as typeof april;
  });

  it('goes to someone else for approval, and is then final', async () => {
    const sent = await payroll.browser.send('post', `/v1/payroll/runs/${april.id}/submit`);
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.status).toBe('PENDING_APPROVAL');
    // Nothing is approved by the person who prepared it.
    expect(((await payroll.browser.get('/v1/approvals/inbox')).body as unknown[]).length).toBe(0);
    const request = await db.approvalRequest.findUniqueOrThrow({
      where: { id: sent.body.approvalRequestId },
    });
    expect(request).toMatchObject({ subjectType: 'payroll_run', currency: 'INR' });
    expect(Number(request.amount)).toBe(sent.body.net);
    expect(
      (
        await payroll.browser.send('patch', `/v1/payroll/payslips/${slipOf(april, ravi.employeeId).id}`, {
          lopOverride: 0,
        })
      ).body.code,
    ).toBe('RUN_LOCKED');

    // Employees don't see a payslip before approval.
    expect(((await asha.browser.get('/v1/payroll/me/payslips')).body.payslips as unknown[]).length).toBe(0);

    const inbox = (await owner.get('/v1/approvals/inbox')).body as { id: string; request: { id: string } }[];
    const task = inbox.find((t) => t.request.id === request.id)!;
    expect(
      (await owner.send('post', `/v1/approvals/tasks/${task.id}/decision`, { decision: 'APPROVE' })).status,
    ).toBe(200);
    const approved = (await payroll.browser.get(`/v1/payroll/runs/${april.id}`)).body;
    expect(approved).toMatchObject({ status: 'APPROVED', can: { export: true, markPaid: true } });
    expect(
      await db.notification.count({
        where: { tenantId, recipientUserId: asha.userId, category: 'payroll.payslip' },
      }),
    ).toBe(1);

    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.payslip.updateMany({ where: { runId: april.id }, data: { net: 1 } }),
      ),
    ).rejects.toThrow(/payroll run is approved/);
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.payrollRun.update({ where: { id: april.id }, data: { status: 'DRAFT' } }),
      ),
    ).rejects.toThrow(/can't go from approved to draft/);
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.employeeSalary.updateMany({ where: { employeeId: asha.employeeId }, data: { note: 'x' } }),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('shows employees their own payslips, with a PDF, and no one else’s', async () => {
    const mine = (await asha.browser.get('/v1/payroll/me/payslips')).body as {
      payslips: { id: string; net: number; period: string }[];
    };
    expect(mine.payslips).toHaveLength(1);
    expect(mine.payslips[0]).toMatchObject({ period: 'April 2026' });
    const pdf = await asha.browser.agent
      .get(`/v1/payroll/payslips/${mine.payslips[0]!.id}/pdf`)
      .set('Origin', 'http://localhost:3000');
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((await ravi.browser.get(`/v1/payroll/payslips/${mine.payslips[0]!.id}`)).status).toBe(404);
  });

  it('makes the register, the bank transfer list and the PF return from approved pay only', async () => {
    const register = await payroll.browser.get(`/v1/payroll/runs/${april.id}/register.csv`);
    expect(register.status).toBe(200);
    expect(register.text).toContain('Employee code,Name,Paid days');
    expect(register.text).toContain('Referral bonus');
    const bank = await payroll.browser.get(`/v1/payroll/runs/${april.id}/bank.csv`);
    expect(bank.status).toBe(200);
    expect(bank.text).toContain('123456789012,HDFC0001234');
    // Ravi has no bank details yet, so he is listed as left out.
    expect(bank.text).toMatch(/Not included \(no bank account or IFSC\): /);
    const ecr = await payroll.browser.get(`/v1/payroll/runs/${april.id}/pf-ecr.txt`);
    expect(ecr.status).toBe(200);
    expect(ecr.text.trim().split('\n')).toEqual([
      expect.stringMatching(/^100200300400#~#PAY-ASHA TEST#~#63000#~#/),
    ]);
    expect(await db.auditEvent.count({ where: { tenantId, action: 'payroll.export.bank' } })).toBe(1);

    const paid = await payroll.browser.send('post', `/v1/payroll/runs/${april.id}/paid`);
    expect(paid.body.status).toBe('PAID');
  });
});

describe('the next month', () => {
  it('keeps salary revisions out of paid months, carries ESI coverage and counts tax already deducted', async () => {
    const late = await payroll.browser.send('post', `/v1/payroll/employees/${ravi.employeeId}/salaries`, {
      effectiveFrom: '2026-04-20',
      annualCtc: 360_000,
      lines: [{ componentId: components.BASIC, monthly: 25_000 }],
    });
    expect(late.body.code).toBe('PERIOD_CLOSED');
    const raise = await payroll.browser.send('post', `/v1/payroll/employees/${ravi.employeeId}/salaries`, {
      effectiveFrom: '2026-05-01',
      annualCtc: 360_000,
      lines: [
        { componentId: components.BASIC, monthly: 12_500 },
        { componentId: components.SPECIAL, monthly: 12_500 },
      ],
    });
    expect(raise.status, JSON.stringify(raise.body)).toBe(201);
    const may = await payroll.browser.send('post', '/v1/payroll/runs', {
      companyId: acme,
      year: 2026,
      month: 5,
    });
    expect(may.status, JSON.stringify(may.body)).toBe(201);
    const r = slipOf(may.body as typeof april, ravi.employeeId);
    // ₹25,000 is over the ESI ceiling, but coverage lasts the April–September period.
    expect(r.esiCovered).toBe(true);
    expect(line(r.deductions, 'ESI')).toBe(Math.ceil(25_000 * 0.0075));
    const earlier = await payroll.browser.send('post', '/v1/payroll/runs', {
      companyId: acme,
      year: 2026,
      month: 3,
    });
    expect(earlier.body.code).toBe('PERIOD_CLOSED');
    const cancelled = await payroll.browser.send('post', `/v1/payroll/runs/${may.body.id}/cancel`);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(
      (await payroll.browser.send('post', '/v1/payroll/runs', { companyId: acme, year: 2026, month: 5 }))
        .status,
    ).toBe(201);
  });

  it('needs payroll in the plan', async () => {
    await db.entitlementOverride.create({
      data: {
        tenantId,
        kind: 'FEATURE',
        key: 'payroll',
        enabled: false,
        reason: 'test',
        createdByUserId: ownerId,
      },
    });
    try {
      const res = await payroll.browser.get('/v1/payroll/runs');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ENTITLEMENT_REQUIRED');
    } finally {
      await db.entitlementOverride.deleteMany({ where: { tenantId, key: 'payroll' } });
    }
  });
});
