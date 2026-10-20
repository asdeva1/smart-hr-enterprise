/**
 * The books through the real API and database: a starting chart of accounts, journals that balance and
 * post only once approved, reversals instead of edits, closed periods, reports that agree, payroll posting
 * itself on approval and payment, and the database refusing unbalanced or rewritten entries.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDatabaseClient, withTenant } from '@smart-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import { Browser, Fixtures, ownerClient, requireEnv, startApp, testEnv } from './helpers.js';

const db = ownerClient();
const runtime = createDatabaseClient({ connectionString: requireEnv('DATABASE_URL'), maxConnections: 2 });
const fx = new Fixtures(db);
let app: NestExpressApplication;
let tenantId: string;
let ownerId: string;
let owner: Browser;
let accountant: Browser;
let viewer: Browser;
let acme: string;
let acct: Record<string, string>;

async function login(label: string, permissions: string[]) {
  const user = await fx.user(label);
  const m = await fx.member(tenantId, user.id);
  await fx.assign(tenantId, m.id, await fx.customRole(tenantId, label, permissions), {
    type: 'TENANT',
    id: tenantId,
  });
  const b = new Browser(app);
  expect((await b.login(user.email)).status).toBe(200);
  return b;
}

async function approve(approvalRequestId: string) {
  const inbox = (await owner.get('/v1/approvals/inbox')).body as { id: string; request: { id: string } }[];
  const task = inbox.find((t) => t.request.id === approvalRequestId);
  expect(task).toBeDefined();
  const res = await owner.send('post', `/v1/approvals/tasks/${task!.id}/decision`, { decision: 'APPROVE' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

const journal = (date: string, narration: string, lines: [string, number, number][]) => ({
  companyId: acme,
  date,
  narration,
  lines: lines.map(([code, debit, credit]) => ({ accountId: acct[code]!, debit, credit })),
});

async function postJournal(body: ReturnType<typeof journal>) {
  const draft = await accountant.send('post', '/v1/finance/journals', body);
  expect(draft.status, JSON.stringify(draft.body)).toBe(201);
  const sent = await accountant.send('post', `/v1/finance/journals/${draft.body.id}/submit`);
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  await approve(sent.body.approvalRequestId as string);
  return (await accountant.get(`/v1/finance/journals/${draft.body.id}`)).body as {
    id: string;
    number: string;
    status: string;
  };
}

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  const tenant = await fx.tenant('Finance');
  tenantId = tenant.id;
  const ownerUser = await fx.user('fin-owner');
  ownerId = ownerUser.id;
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  acme = (await fx.company(tenantId, 'ACME')).id;
  accountant = await login('fin-accountant', [
    'finance.view',
    'finance.manage',
    'finance.configure',
    'payroll.view',
    'payroll.manage',
    'employees.view',
  ]);
  viewer = await login('fin-viewer', ['finance.view']);
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await runtime.$disconnect();
  await db.$disconnect();
});

describe('chart of accounts', () => {
  it('starts with a standard chart and takes new accounts', async () => {
    const res = await accountant.get(`/v1/finance/accounts?companyId=${acme}`);
    expect(res.status).toBe(200);
    const list = res.body as { id: string; code: string; systemKey: string | null }[];
    acct = Object.fromEntries(list.map((a) => [a.code, a.id]));
    expect(list.filter((a) => a.systemKey).map((a) => a.systemKey)).toEqual(
      expect.arrayContaining([
        'BANK',
        'SALARY_PAYABLE',
        'PF_PAYABLE',
        'TDS_PAYABLE',
        'SALARY_EXPENSE',
        'RETAINED_EARNINGS',
      ]),
    );
    const added = await accountant.send('post', '/v1/finance/accounts', {
      companyId: acme,
      code: '4200',
      name: 'Consulting income',
      type: 'INCOME',
    });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    acct['4200'] = added.body.id as string;
    expect(
      (
        await accountant.send('post', '/v1/finance/accounts', {
          companyId: acme,
          code: '4200',
          name: 'Again',
          type: 'INCOME',
        })
      ).body.code,
    ).toBe('CODE_TAKEN');
    expect(
      (
        await viewer.send('post', '/v1/finance/accounts', {
          companyId: acme,
          code: '4300',
          name: 'Nope',
          type: 'INCOME',
        })
      ).status,
    ).toBe(403);
    expect(
      (await accountant.send('patch', `/v1/finance/accounts/${acct['1100']}`, { status: 'ARCHIVED' })).body
        .code,
    ).toBe('SYSTEM_ACCOUNT');
  });
});

describe('journals', () => {
  let capitalId: string;

  it('must balance, and post only when someone else approves', async () => {
    const unbalanced = await accountant.send(
      'post',
      '/v1/finance/journals',
      journal('2026-04-01', 'Capital', [
        ['1100', 500_000, 0],
        ['3000', 0, 400_000],
      ]),
    );
    expect(unbalanced.status).toBe(400);
    expect(unbalanced.body.code).toBe('JOURNAL_UNBALANCED');
    const draft = await accountant.send(
      'post',
      '/v1/finance/journals',
      journal('2026-04-01', 'Capital introduced', [
        ['1100', 500_000, 0],
        ['3000', 0, 500_000],
      ]),
    );
    expect(draft.status).toBe(201);
    expect(draft.body).toMatchObject({ status: 'DRAFT', number: null, total: 500_000 });
    const sent = await accountant.send('post', `/v1/finance/journals/${draft.body.id}/submit`);
    expect(sent.body.status).toBe('PENDING_APPROVAL');
    expect(((await accountant.get('/v1/approvals/inbox')).body as unknown[]).length).toBe(0);
    await approve(sent.body.approvalRequestId as string);
    const posted = (await accountant.get(`/v1/finance/journals/${draft.body.id}`)).body;
    expect(posted).toMatchObject({
      status: 'POSTED',
      number: 'JV/2026-27/00001',
      can: { reverse: true, edit: false },
    });
    capitalId = posted.id as string;

    const sale = await postJournal(
      journal('2026-04-20', 'Consulting for Beta Ltd', [
        ['1200', 118_000, 0],
        ['4200', 0, 118_000],
      ]),
    );
    expect(sale.number).toBe('JV/2026-27/00002');
    await postJournal(
      journal('2026-04-25', 'Rent for April', [
        ['5200', 40_000, 0],
        ['1100', 0, 40_000],
      ]),
    );
  });

  it('can’t be changed once posted, even directly in the database', async () => {
    expect(
      (
        await accountant.send(
          'put',
          `/v1/finance/journals/${capitalId}`,
          journal('2026-04-01', 'Changed', [
            ['1100', 1, 0],
            ['3000', 0, 1],
          ]),
        )
      ).body.code,
    ).toBe('JOURNAL_LOCKED');
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.journalEntry.update({ where: { id: capitalId }, data: { narration: 'rewritten' } }),
      ),
    ).rejects.toThrow(/posted journals can't be changed/);
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.journalLine.create({
          data: { tenantId, entryId: capitalId, position: 9, accountId: acct['1100']!, debit: 1 },
        }),
      ),
    ).rejects.toThrow(/the journal is posted/);
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.journalEntry.create({
          data: {
            tenantId,
            companyId: acme,
            date: new Date(),
            narration: 'x',
            status: 'POSTED',
            createdByUserId: ownerId,
          },
        }),
      ),
    ).rejects.toThrow(/must start as a draft/);
    // A draft forced to posted without balancing is refused too.
    const draft = await withTenant(runtime, tenantId, async (tx) => {
      const e = await tx.journalEntry.create({
        data: {
          tenantId,
          companyId: acme,
          date: new Date('2026-04-30T00:00:00Z'),
          narration: 'x',
          createdByUserId: ownerId,
        },
      });
      await tx.journalLine.create({
        data: { tenantId, entryId: e.id, position: 1, accountId: acct['1100']!, debit: 10 },
      });
      return e;
    });
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.journalEntry.update({
          where: { id: draft.id },
          data: { status: 'POSTED', number: 'X', postedAt: new Date(), total: 10 },
        }),
      ),
    ).rejects.toThrow(/doesn't balance/);
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.journalLine.create({
          data: { tenantId, entryId: draft.id, position: 2, accountId: acct['3000']!, debit: 5, credit: 5 },
        }),
      ),
    ).rejects.toThrow(/journal_line_one_side/);
    await accountant.send('post', `/v1/finance/journals/${draft.id}/cancel`);
  });

  it('agree in the reports', async () => {
    const tb = (await viewer.get(`/v1/finance/reports/trial-balance?companyId=${acme}&to=2026-04-30`)).body;
    expect(tb.debit).toBe(tb.credit);
    expect(tb.debit).toBe(618_000);
    const pl = (await viewer.get(`/v1/finance/reports/profit-and-loss?companyId=${acme}&to=2026-04-30`)).body;
    expect(pl).toMatchObject({
      from: '2026-04-01',
      income: { total: 118_000 },
      expenses: { total: 40_000 },
      profit: 78_000,
    });
    const bs = (await viewer.get(`/v1/finance/reports/balance-sheet?companyId=${acme}&to=2026-04-30`)).body;
    expect(bs).toMatchObject({
      balanced: true,
      assets: { total: 578_000 },
      equity: { currentEarnings: 78_000, total: 578_000 },
    });
    const ledger = (
      await viewer.get(`/v1/finance/accounts/${acct['1100']}/ledger?from=2026-04-10&to=2026-04-30`)
    ).body;
    expect(ledger).toMatchObject({ opening: 500_000, closing: 460_000 });
    expect(ledger.rows).toHaveLength(1);
  });
});

describe('payroll in the books', () => {
  it('posts the salary cost on approval and the payment when paid', async () => {
    const employee = await owner.send('post', '/v1/employees', {
      firstName: 'Kavya',
      lastName: 'Test',
      companyId: acme,
      dateOfJoining: '2025-01-01',
    });
    const components = (await accountant.get('/v1/payroll/components')).body as {
      id: string;
      code: string;
    }[];
    const c = Object.fromEntries(components.map((x) => [x.code, x.id]));
    const salary = await accountant.send('post', `/v1/payroll/employees/${employee.body.id}/salaries`, {
      effectiveFrom: '2025-01-01',
      annualCtc: 800_000,
      lines: [
        { componentId: c.BASIC, monthly: 30_000 },
        { componentId: c.SPECIAL, monthly: 30_000 },
      ],
    });
    expect(salary.status, JSON.stringify(salary.body)).toBe(201);
    await accountant.send('put', `/v1/payroll/employees/${employee.body.id}/profile`, {
      pfEnabled: true,
      esiEnabled: true,
      ptState: 'KA',
    });
    const run = await accountant.send('post', '/v1/payroll/runs', { companyId: acme, year: 2026, month: 4 });
    expect(run.status, JSON.stringify(run.body)).toBe(201);
    const sent = await accountant.send('post', `/v1/payroll/runs/${run.body.id}/submit`);
    await approve(sent.body.approvalRequestId as string);

    const journals = (await viewer.get(`/v1/finance/journals?companyId=${acme}&status=POSTED`)).body as {
      source: string;
      sourceId: string;
      date: string;
      total: number;
      lines: { account: { code: string }; debit: number; credit: number }[];
    }[];
    const accrual = journals.find((j) => j.source === 'PAYROLL' && j.sourceId === run.body.id)!;
    expect(accrual).toBeDefined();
    expect(accrual.date).toBe('2026-04-30');
    const amount = (code: string, side: 'debit' | 'credit') =>
      accrual.lines.find((l) => l.account.code === code)?.[side] ?? 0;
    expect(amount('5000', 'debit')).toBe(60_000);
    // Employer PF 1,800 (EPF + pension) + EDLI 75 + admin 75.
    expect(amount('5100', 'debit')).toBe(1_950);
    expect(amount('2200', 'credit')).toBe(1_800 + 1_950);
    expect(amount('2220', 'credit')).toBe(200);
    expect(amount('2100', 'credit')).toBe(60_000 - 1_800 - 200);
    expect(accrual.total).toBe(61_950);

    await accountant.send('post', `/v1/payroll/runs/${run.body.id}/paid`);
    const after = (await viewer.get(`/v1/finance/journals?companyId=${acme}&status=POSTED`))
      .body as typeof journals;
    const payment = after.find((j) => j.source === 'PAYROLL_PAYMENT')!;
    expect(payment.lines.map((l) => [l.account.code, l.debit, l.credit])).toEqual([
      ['2100', 58_000, 0],
      ['1100', 0, 58_000],
    ]);
  });
});

describe('closing the books', () => {
  it('stops postings in closed months; mistakes there are reversed in an open month', async () => {
    const open = await accountant.send(
      'post',
      '/v1/finance/journals',
      journal('2026-04-28', 'Late bill', [
        ['5300', 1_000, 0],
        ['2000', 0, 1_000],
      ]),
    );
    expect(
      (await accountant.send('put', `/v1/finance/books/${acme}`, { lockedUntil: '2026-04-30' })).body.code,
    ).toBe('OPEN_JOURNALS');
    await accountant.send('post', `/v1/finance/journals/${open.body.id}/cancel`);
    const closed = await accountant.send('put', `/v1/finance/books/${acme}`, { lockedUntil: '2026-04-30' });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect((await viewer.send('put', `/v1/finance/books/${acme}`, { lockedUntil: null })).status).toBe(403);

    const late = await accountant.send(
      'post',
      '/v1/finance/journals',
      journal('2026-04-15', 'Too late', [
        ['5300', 1, 0],
        ['1100', 0, 1],
      ]),
    );
    expect(late.body.code).toBe('BOOKS_CLOSED');

    const all = (
      await viewer.get(`/v1/finance/journals?companyId=${acme}&status=POSTED&from=2026-04-25&to=2026-04-25`)
    ).body as { id: string }[];
    const rent = all[0]!.id;
    expect(
      (await accountant.send('post', `/v1/finance/journals/${rent}/reverse`, { date: '2026-04-29' })).body
        .code,
    ).toBe('BOOKS_CLOSED');
    const reversal = await accountant.send('post', `/v1/finance/journals/${rent}/reverse`, {
      date: '2026-05-05',
    });
    expect(reversal.status, JSON.stringify(reversal.body)).toBe(201);
    expect(reversal.body).toMatchObject({ status: 'POSTED', source: 'REVERSAL', reversesId: rent });
    expect(
      (reversal.body as { lines: { debit: number; credit: number }[] }).lines.map((l) => [l.debit, l.credit]),
    ).toEqual([
      [0, 40_000],
      [40_000, 0],
    ]);
    expect(
      (await accountant.send('post', `/v1/finance/journals/${rent}/reverse`, { date: '2026-05-06' })).body
        .code,
    ).toBe('ALREADY_REVERSED');
    // April's figures are unchanged; May shows the correction.
    const april = (
      await viewer.get(`/v1/finance/reports/profit-and-loss?companyId=${acme}&from=2026-04-01&to=2026-04-30`)
    ).body;
    expect(april.expenses.total).toBe(40_000 + 61_950);
    const may = (
      await viewer.get(`/v1/finance/reports/profit-and-loss?companyId=${acme}&from=2026-05-01&to=2026-05-31`)
    ).body;
    expect(may.expenses.total).toBe(-40_000);
  });

  it('needs finance in the plan', async () => {
    await db.entitlementOverride.create({
      data: {
        tenantId,
        kind: 'FEATURE',
        key: 'finance',
        enabled: false,
        reason: 'test',
        createdByUserId: ownerId,
      },
    });
    try {
      const res = await viewer.get(`/v1/finance/accounts?companyId=${acme}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ENTITLEMENT_REQUIRED');
    } finally {
      await db.entitlementOverride.deleteMany({ where: { tenantId, key: 'finance' } });
    }
  });
});
