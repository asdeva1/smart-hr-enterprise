/**
 * Procurement through the real API and database: purchase requests approved by the reporting manager,
 * purchase orders worked out to the paisa and approved by the owners, goods received in parts, who can see
 * what, and the plan gate.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import { lineAmounts } from '../src/procurement/procurement.service.js';
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

async function decide(
  approver: Browser,
  approvalRequestId: string,
  decision: 'APPROVE' | 'RETURN' | 'REJECT',
) {
  const inbox = (await approver.get('/v1/approvals/inbox')).body as { id: string; request: { id: string } }[];
  const task = inbox.find((t) => t.request.id === approvalRequestId);
  expect(task, 'the approver has the task').toBeDefined();
  const res = await approver.send('post', `/v1/approvals/tasks/${task!.id}/decision`, {
    decision,
    comment: decision === 'APPROVE' ? undefined : 'Please check',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

let manager: Person;
let asha: Person;
let buyer: Person;
let stranger: Person;
let vendorId: string;

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  const tenant = await fx.tenant('Procurement');
  tenantId = tenant.id;
  const ownerUser = await fx.user('proc-owner');
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  acme = (await fx.company(tenantId, 'ACME')).id;

  manager = await person('proc-manager');
  asha = await person('proc-asha', manager.employeeId);
  stranger = await person('proc-stranger');
  buyer = await person('proc-buyer', undefined, [
    'procurement.view',
    'procurement.manage',
    'vendors.view',
    'vendors.manage',
  ]);

  const vendor = await buyer.browser.send('post', '/v1/vendors', { code: 'OFFICEMART', name: 'Office Mart' });
  expect(vendor.status, JSON.stringify(vendor.body)).toBe(201);
  vendorId = vendor.body.id;
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await db.$disconnect();
});

describe('line amounts', () => {
  it('are worked out in whole paise', () => {
    expect(lineAmounts(3, 199.99, 18)).toEqual({ net: 59997, tax: 10799 });
    expect(lineAmounts(0.5, 10, 5)).toEqual({ net: 500, tax: 25 });
    expect(lineAmounts(2.125, 100, 0)).toEqual({ net: 21250, tax: 0 });
  });
});

describe('purchase requests', () => {
  let requestId: string;

  it('are drafted by any employee, with the estimate worked out', async () => {
    const res = await asha.browser.send('post', '/v1/procurement/requests', {
      title: 'Laptop stand',
      justification: 'Ergonomics',
      lines: [
        { description: 'Stand', quantity: 2, estimatedUnitPrice: 1500.5 },
        { description: 'Cable', quantity: 1, estimatedUnitPrice: 99 },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    requestId = res.body.id;
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.estimatedTotal).toBe(3100);
    expect(
      (await asha.browser.send('post', '/v1/procurement/requests', { title: 'x', lines: [] })).status,
    ).toBe(400);
  });

  it('are private to the requester, their approver and procurement staff', async () => {
    expect((await stranger.browser.get(`/v1/procurement/requests/${requestId}`)).status).toBe(404);
    expect((await buyer.browser.get(`/v1/procurement/requests/${requestId}`)).status).toBe(200);
    expect((await stranger.browser.get('/v1/procurement/requests?scope=all')).body).toHaveLength(0);
    expect((await asha.browser.get('/v1/procurement/requests')).body).toHaveLength(1);
  });

  it('go to the reporting manager and, once approved, become an order', async () => {
    const sent = await asha.browser.send('post', `/v1/procurement/requests/${requestId}/submit`);
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.number).toMatch(/^PR-\d{6}$/);
    expect(
      (
        await asha.browser.send('put', `/v1/procurement/requests/${requestId}`, {
          title: 'Changed',
          lines: [{ description: 'x1', quantity: 1, estimatedUnitPrice: 1 }],
        })
      ).status,
    ).toBe(409);
    // Not approved yet, so it can't be ordered.
    const early = await buyer.browser.send('post', '/v1/procurement/orders', {
      companyId: acme,
      vendorId,
      requestId,
      orderDate: today,
      lines: [{ description: 'Stand', quantity: 2, unitPrice: 1500 }],
    });
    expect(early.status).toBe(400);

    await decide(manager.browser, sent.body.approvalRequest.id as string, 'APPROVE');
    expect((await asha.browser.get(`/v1/procurement/requests/${requestId}`)).body.status).toBe('APPROVED');

    const order = await buyer.browser.send('post', '/v1/procurement/orders', {
      companyId: acme,
      vendorId,
      requestId,
      orderDate: today,
      lines: [{ description: 'Stand', quantity: 2, unitPrice: 1500 }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    expect((await asha.browser.get(`/v1/procurement/requests/${requestId}`)).body.status).toBe('ORDERED');

    // Calling the order off frees the request again.
    expect(
      (await buyer.browser.send('post', `/v1/procurement/orders/${order.body.id}/cancel`)).body.status,
    ).toBe('CANCELLED');
    expect((await asha.browser.get(`/v1/procurement/requests/${requestId}`)).body.status).toBe('APPROVED');
  });

  it('can be sent back, corrected, sent again and withdrawn', async () => {
    const created = await asha.browser.send('post', '/v1/procurement/requests', {
      title: 'Chair',
      lines: [{ description: 'Chair', quantity: 1, estimatedUnitPrice: 8000 }],
    });
    const id = created.body.id as string;
    const sent = await asha.browser.send('post', `/v1/procurement/requests/${id}/submit`);
    const approvalId = sent.body.approvalRequest.id as string;
    await decide(manager.browser, approvalId, 'RETURN');
    const back = await asha.browser.get(`/v1/procurement/requests/${id}`);
    expect(back.body.status).toBe('DRAFT');
    expect(back.body.decisionNote).toBe('Please check');
    const again = await asha.browser.send('post', `/v1/procurement/requests/${id}/submit`);
    expect(again.body.status).toBe('PENDING_APPROVAL');
    expect(again.body.number).toBe(sent.body.number);
    const gone = await asha.browser.send('post', `/v1/procurement/requests/${id}/cancel`);
    expect(gone.body.status).toBe('CANCELLED');
  });
});

describe('purchase orders', () => {
  let orderId: string;
  let lineA: string;
  let lineB: string;

  it('are raised by procurement.manage, with tax and totals worked out', async () => {
    const body = {
      companyId: acme,
      vendorId,
      orderDate: today,
      terms: 'Net 30',
      lines: [
        { description: 'Paper', quantity: 10, unitPrice: 250, taxRate: 12 },
        { description: 'Toner', quantity: 3, unitPrice: 199.99, taxRate: 18 },
      ],
    };
    expect((await asha.browser.send('post', '/v1/procurement/orders', body)).status).toBe(403);
    const res = await buyer.browser.send('post', '/v1/procurement/orders', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    orderId = res.body.id;
    expect(res.body.subtotal).toBe(3099.97);
    expect(res.body.taxTotal).toBe(300 + 107.99);
    expect(res.body.total).toBe(3507.96);
    [lineA, lineB] = (res.body.lines as { id: string }[]).map((l) => l.id) as [string, string];
  });

  it('are hidden from people with no stake in them', async () => {
    expect((await stranger.browser.get(`/v1/procurement/orders/${orderId}`)).status).toBe(404);
    expect((await stranger.browser.get('/v1/procurement/orders')).body).toHaveLength(0);
    expect((await buyer.browser.get('/v1/procurement/orders')).body.length).toBeGreaterThan(0);
  });

  it('cannot take goods before they are approved', async () => {
    const r = await buyer.browser.send('post', `/v1/procurement/orders/${orderId}/receive`, {
      receivedOn: today,
      lines: [{ orderLineId: lineA, quantity: 1 }],
    });
    expect(r.status).toBe(409);
  });

  it('go to the owners for approval and lock once sent', async () => {
    const sent = await buyer.browser.send('post', `/v1/procurement/orders/${orderId}/submit`);
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.status).toBe('PENDING_APPROVAL');
    expect(sent.body.number).toMatch(/^PO-\d{6}$/);
    expect(
      (
        await buyer.browser.send('put', `/v1/procurement/orders/${orderId}`, {
          vendorId,
          orderDate: today,
          lines: [{ description: 'x1', quantity: 1, unitPrice: 1 }],
        })
      ).status,
    ).toBe(409);
    await decide(owner, sent.body.approvalRequest.id as string, 'APPROVE');
    expect((await buyer.browser.get(`/v1/procurement/orders/${orderId}`)).body.status).toBe('APPROVED');
  });

  it('take goods in parts, never more than ordered', async () => {
    const part = await buyer.browser.send('post', `/v1/procurement/orders/${orderId}/receive`, {
      receivedOn: today,
      lines: [{ orderLineId: lineA, quantity: 10 }],
    });
    expect(part.status, JSON.stringify(part.body)).toBe(201);
    expect(part.body.status).toBe('PARTIALLY_RECEIVED');
    expect(part.body.receipts[0].number).toMatch(/^GRN-\d{6}$/);

    const over = await buyer.browser.send('post', `/v1/procurement/orders/${orderId}/receive`, {
      receivedOn: today,
      lines: [{ orderLineId: lineB, quantity: 4 }],
    });
    expect(over.status).toBe(400);
    const again = await buyer.browser.send('post', `/v1/procurement/orders/${orderId}/receive`, {
      receivedOn: today,
      lines: [{ orderLineId: lineA, quantity: 1 }],
    });
    expect(again.status).toBe(400);

    const rest = await buyer.browser.send('post', `/v1/procurement/orders/${orderId}/receive`, {
      receivedOn: today,
      note: 'Second delivery',
      lines: [{ orderLineId: lineB, quantity: 3 }],
    });
    expect(rest.body.status).toBe('RECEIVED');
    expect(rest.body.receipts).toHaveLength(2);
    expect((await buyer.browser.send('post', `/v1/procurement/orders/${orderId}/cancel`)).status).toBe(409);
  });

  it('can be sent back and corrected, rejected orders free their request', async () => {
    const make = async () =>
      (
        await buyer.browser.send('post', '/v1/procurement/orders', {
          companyId: acme,
          vendorId,
          orderDate: today,
          lines: [{ description: 'Desk', quantity: 1, unitPrice: 5000 }],
        })
      ).body.id as string;
    const id = await make();
    const sent = await buyer.browser.send('post', `/v1/procurement/orders/${id}/submit`);
    const approvalId = sent.body.approvalRequest.id as string;
    await decide(owner, approvalId, 'RETURN');
    expect((await buyer.browser.get(`/v1/procurement/orders/${id}`)).body.status).toBe('DRAFT');
    const fixed = await buyer.browser.send('put', `/v1/procurement/orders/${id}`, {
      vendorId,
      orderDate: today,
      lines: [{ description: 'Desk', quantity: 2, unitPrice: 5000 }],
    });
    expect(fixed.body.total).toBe(10000);
    await buyer.browser.send('post', `/v1/procurement/orders/${id}/submit`);
    await decide(owner, approvalId, 'REJECT');
    expect((await buyer.browser.get(`/v1/procurement/orders/${id}`)).body.status).toBe('REJECTED');
  });

  it('refuse an archived vendor', async () => {
    const v = await buyer.browser.send('post', '/v1/vendors', { code: 'OLDCO', name: 'Old Co' });
    await buyer.browser.send('patch', `/v1/vendors/${v.body.id}`, { status: 'ARCHIVED' });
    const res = await buyer.browser.send('post', '/v1/procurement/orders', {
      companyId: acme,
      vendorId: v.body.id,
      orderDate: today,
      lines: [{ description: 'Desk', quantity: 1, unitPrice: 5000 }],
    });
    expect(res.status).toBe(400);
  });
});

describe('plan gate', () => {
  it('hides procurement from an organisation whose plan lacks it', async () => {
    const lite = await fx.tenant('ProcLite', 'ACTIVE', { plan: 'LITE' });
    const user = await fx.user('proc-lite');
    await fx.member(lite.id, user.id, true);
    const b = new Browser(app);
    await b.login(user.email);
    expect((await b.get('/v1/procurement/requests')).status).toBe(403);
  });
});
