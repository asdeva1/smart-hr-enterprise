/**
 * Vendors and expense claims through the real API and database: category rules, drafts and their edits,
 * the approval engine with the reporting manager as approver, send-back and resubmit, payment by finance,
 * visibility, vendor permissions and the plan gate.
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

async function person(label: string, managerId?: string, role?: { permissions: string[] }): Promise<Person> {
  const user = await fx.user(label);
  const m = await fx.member(tenantId, user.id);
  if (role) {
    await fx.assign(tenantId, m.id, await fx.customRole(tenantId, label, role.permissions), {
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

async function decide(
  approver: Person,
  approvalRequestId: string,
  decision: 'APPROVE' | 'RETURN' | 'REJECT',
) {
  const inbox = (await approver.browser.get('/v1/approvals/inbox')).body as {
    id: string;
    request: { id: string };
  }[];
  const task = inbox.find((t) => t.request.id === approvalRequestId);
  expect(task, 'the approver has the task').toBeDefined();
  const res = await approver.browser.send('post', `/v1/approvals/tasks/${task!.id}/decision`, {
    decision,
    comment: decision === 'APPROVE' ? undefined : 'Please check',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

let manager: Person;
let ravi: Person;
let finance: Person;
let stranger: Person;
let travel: string;
let meals: string;

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  const tenant = await fx.tenant('Expenses');
  tenantId = tenant.id;
  const ownerUser = await fx.user('exp-owner');
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  acme = (await fx.company(tenantId, 'ACME')).id;

  manager = await person('exp-manager');
  ravi = await person('exp-ravi', manager.employeeId);
  stranger = await person('exp-stranger');
  finance = await person('exp-finance', undefined, {
    permissions: ['expenses.view', 'expenses.manage', 'vendors.view', 'vendors.manage'],
  });

  const category = async (body: Record<string, unknown>) => {
    const res = await owner.send('post', '/v1/expenses/categories', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };
  travel = await category({ code: 'TRAVEL', name: 'Travel', requiresReceipt: true, maxAmount: 5000 });
  meals = await category({ code: 'MEALS', name: 'Meals' });
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await db.$disconnect();
});

describe('categories', () => {
  it('are managed by expenses.manage but visible to everyone who files claims', async () => {
    expect((await ravi.browser.get('/v1/expenses/categories')).body).toHaveLength(2);
    expect(
      (await ravi.browser.send('post', '/v1/expenses/categories', { code: 'X1', name: 'Nope' })).status,
    ).toBe(403);
    expect(
      (await finance.browser.send('post', '/v1/expenses/categories', { code: 'TRAVEL', name: 'Again' }))
        .status,
    ).toBe(400);
  });
});

describe('claims', () => {
  let claimId: string;

  it('check each line against its category', async () => {
    const claim = (lines: unknown[]) =>
      ravi.browser.send('post', '/v1/expenses/claims', { title: 'Client visit', lines });
    const line = { date: day(-2), categoryId: travel, description: 'Cab', amount: 400, receiptNumber: 'R-1' };
    expect((await claim([{ ...line, receiptNumber: undefined }])).status).toBe(400);
    expect((await claim([{ ...line, amount: 6000 }])).status).toBe(400);
    expect((await claim([{ ...line, date: day(10) }])).status).toBe(400);
    expect((await claim([])).status).toBe(400);
  });

  it('are saved as a draft with the total worked out, and can be edited while a draft', async () => {
    const res = await ravi.browser.send('post', '/v1/expenses/claims', {
      title: 'Client visit',
      lines: [
        { date: day(-2), categoryId: travel, description: 'Cab', amount: 400.5, receiptNumber: 'R-1' },
        { date: day(-1), categoryId: meals, description: 'Lunch', amount: 250 },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    claimId = res.body.id;
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.total).toBe(650.5);
    expect(res.body.number).toBeNull();

    const edited = await ravi.browser.send('put', `/v1/expenses/claims/${claimId}`, {
      title: 'Client visit, Pune',
      lines: [{ date: day(-1), categoryId: meals, description: 'Lunch', amount: 300 }],
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.total).toBe(300);
    expect(edited.body.lines).toHaveLength(1);
  });

  it('are private to the claimant, their approver and people who can see expenses', async () => {
    expect((await stranger.browser.get(`/v1/expenses/claims/${claimId}`)).status).toBe(404);
    expect((await finance.browser.get(`/v1/expenses/claims/${claimId}`)).status).toBe(200);
    const all = await stranger.browser.get('/v1/expenses/claims?scope=all');
    expect(all.body).toHaveLength(0);
    expect((await finance.browser.get('/v1/expenses/claims?scope=all')).body.length).toBeGreaterThan(0);
  });

  it('go to the reporting manager, lock when sent, and finance pays them once approved', async () => {
    const sent = await ravi.browser.send('post', `/v1/expenses/claims/${claimId}/submit`);
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.status).toBe('PENDING_APPROVAL');
    expect(sent.body.number).toMatch(/^EXP-\d{6}$/);
    expect(
      (
        await ravi.browser.send('put', `/v1/expenses/claims/${claimId}`, {
          title: 'Changed',
          lines: [{ date: day(-1), categoryId: meals, description: 'x1', amount: 1 }],
        })
      ).status,
    ).toBe(409);
    // Not approved yet, so it can't be paid.
    expect(
      (await finance.browser.send('post', `/v1/expenses/claims/${claimId}/pay`, { reference: 'NEFT-1' }))
        .status,
    ).toBe(409);

    await decide(manager, sent.body.approvalRequest.id as string, 'APPROVE');
    const approved = await ravi.browser.get(`/v1/expenses/claims/${claimId}`);
    expect(approved.body.status).toBe('APPROVED');

    expect(
      (await ravi.browser.send('post', `/v1/expenses/claims/${claimId}/pay`, { reference: 'NEFT-1' })).status,
    ).toBe(403);
    const paid = await finance.browser.send('post', `/v1/expenses/claims/${claimId}/pay`, {
      reference: 'NEFT-1',
    });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect(paid.body.status).toBe('PAID');
    expect(paid.body.paymentReference).toBe('NEFT-1');
    expect(
      (await finance.browser.send('post', `/v1/expenses/claims/${claimId}/pay`, { reference: 'NEFT-2' }))
        .status,
    ).toBe(409);
  });

  it('can be sent back, corrected and sent again, then rejected', async () => {
    const created = await ravi.browser.send('post', '/v1/expenses/claims', {
      title: 'Conference',
      lines: [{ date: day(-3), categoryId: meals, description: 'Dinner', amount: 900 }],
    });
    const id = created.body.id as string;
    const sent = await ravi.browser.send('post', `/v1/expenses/claims/${id}/submit`);
    const approvalId = sent.body.approvalRequest.id as string;

    await decide(manager, approvalId, 'RETURN');
    const back = await ravi.browser.get(`/v1/expenses/claims/${id}`);
    expect(back.body.status).toBe('DRAFT');
    expect(back.body.decisionNote).toBe('Please check');

    const fixed = await ravi.browser.send('put', `/v1/expenses/claims/${id}`, {
      title: 'Conference',
      lines: [{ date: day(-3), categoryId: meals, description: 'Dinner', amount: 800 }],
    });
    expect(fixed.status).toBe(200);
    const again = await ravi.browser.send('post', `/v1/expenses/claims/${id}/submit`);
    expect(again.body.status).toBe('PENDING_APPROVAL');
    expect(again.body.number).toBe(sent.body.number);

    await decide(manager, approvalId, 'REJECT');
    expect((await ravi.browser.get(`/v1/expenses/claims/${id}`)).body.status).toBe('REJECTED');
  });

  it('can be withdrawn, as a draft or while waiting', async () => {
    const make = async () =>
      (
        await ravi.browser.send('post', '/v1/expenses/claims', {
          title: 'Taxi',
          lines: [{ date: day(-1), categoryId: meals, description: 'Taxi', amount: 120 }],
        })
      ).body.id as string;
    const a = await make();
    expect((await ravi.browser.send('post', `/v1/expenses/claims/${a}/cancel`)).body.status).toBe(
      'CANCELLED',
    );
    const b = await make();
    await ravi.browser.send('post', `/v1/expenses/claims/${b}/submit`);
    const cancelled = await ravi.browser.send('post', `/v1/expenses/claims/${b}/cancel`);
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(201);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect((await ravi.browser.send('post', `/v1/expenses/claims/${b}/cancel`)).status).toBe(409);
  });
});

describe('vendors', () => {
  let vendorId: string;

  it('are kept by vendors.manage, with checked tax numbers and unique codes', async () => {
    const body = { code: 'ACME-SUP', name: 'Acme Supplies', gstin: '29ABCDE1234F1Z5', pan: 'ABCDE1234F' };
    expect((await ravi.browser.send('post', '/v1/vendors', body)).status).toBe(403);
    expect((await finance.browser.send('post', '/v1/vendors', { ...body, gstin: '123' })).status).toBe(400);
    const res = await finance.browser.send('post', '/v1/vendors', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    vendorId = res.body.id;
    expect((await finance.browser.send('post', '/v1/vendors', body)).status).toBe(400);
  });

  it('can be found, changed and archived', async () => {
    expect((await finance.browser.get('/v1/vendors?q=acme')).body).toHaveLength(1);
    expect((await ravi.browser.get('/v1/vendors')).status).toBe(403);
    const upd = await finance.browser.send('patch', `/v1/vendors/${vendorId}`, {
      paymentTermsDays: 45,
      status: 'ARCHIVED',
    });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.body.paymentTermsDays).toBe(45);
    expect((await finance.browser.get('/v1/vendors?status=ACTIVE')).body).toHaveLength(0);
  });
});

describe('plan gate', () => {
  it('hides expenses and vendors from an organisation whose plan lacks them', async () => {
    const lite = await fx.tenant('ExpensesLite', 'ACTIVE', { plan: 'LITE' });
    const user = await fx.user('exp-lite');
    await fx.member(lite.id, user.id, true);
    const b = new Browser(app);
    await b.login(user.email);
    expect((await b.get('/v1/expenses/categories')).status).toBe(403);
    expect((await b.get('/v1/vendors')).status).toBe(403);
  });
});
