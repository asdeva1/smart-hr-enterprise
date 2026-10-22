/**
 * Sales and receivables through the real API and database: GST invoices (CGST+SGST within the state, IGST
 * outside), numbering, posting to the books, receipts that settle the oldest invoices, credit notes,
 * ageing and the customer statement.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDatabaseClient } from '@smart-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import { Browser, Fixtures, ownerClient, requireEnv, startApp, testEnv } from './helpers.js';

const db = ownerClient();
const runtime = createDatabaseClient({ connectionString: requireEnv('DATABASE_URL'), maxConnections: 2 });
const fx = new Fixtures(db);
let app: NestExpressApplication;
let tenantId: string;
let accountant: Browser;
let viewer: Browser;
let acme: string;
let bank: string;
let pune: string;
let bengaluru: string;

const lines = [
  { description: 'Implementation services', hsn: '998314', quantity: 1, rate: 120_000, gstRate: 18 },
  { description: 'Monthly support plan', hsn: '998313', quantity: 3, rate: 15_000, gstRate: 18 },
];
const S = '/v1/finance/sales';

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

const draft = async (customerId: string, date: string, type = 'INVOICE', extra: object = {}) => {
  const res = await accountant.send('post', `${S}/documents`, {
    companyId: acme,
    customerId,
    type,
    date,
    lines,
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; total: number };
};
const issue = async (id: string) => {
  const res = await accountant.send('post', `${S}/documents/${id}/issue`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as {
    number: string;
    status: string;
    dueDate: string;
    outstanding: number;
    settled: number;
  };
};
const get = async (id: string) =>
  (await accountant.get(`${S}/documents/${id}`)).body as Record<string, unknown>;

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  tenantId = (await fx.tenant('Sales')).id;
  acme = (await fx.company(tenantId, 'ACME')).id;
  accountant = await login('sales-accountant', ['finance.view', 'finance.manage', 'finance.configure']);
  viewer = await login('sales-viewer', ['finance.view']);
  const chart = (await accountant.get(`/v1/finance/accounts?companyId=${acme}`)).body as {
    id: string;
    code: string;
  }[];
  bank = chart.find((a) => a.code === '1100')!.id;
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await runtime.$disconnect();
  await db.$disconnect();
});

describe('invoices', () => {
  it('need the seller’s state before a tax invoice is issued', async () => {
    const c = await accountant.send('post', `${S}/customers`, {
      name: 'Northwind Retail',
      gstin: '27AAPFU0939F1ZV',
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    pune = c.body.id as string;
    expect(c.body.stateCode).toBe('27');
    const d = await draft(pune, '2026-04-10');
    const res = await accountant.send('post', `${S}/documents/${d.id}/issue`);
    expect(res.body.code).toBe('SELLER_STATE_MISSING');
    expect((await viewer.send('put', `${S}/settings/${acme}`, { gstin: '27AAPFU0939F1ZV' })).status).toBe(
      403,
    );
    const s = await accountant.send('put', `${S}/settings/${acme}`, { gstin: '27AAPFU0939F1ZV' });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.stateCode).toBe('27');
  });

  it('split GST within the state, and are numbered and posted when issued', async () => {
    const d = await draft(pune, '2026-04-10');
    const draftView = await get(d.id);
    expect(draftView).toMatchObject({
      subtotal: 165_000,
      cgst: 14_850,
      sgst: 14_850,
      igst: 0,
      total: 194_700,
      status: 'DRAFT',
    });
    expect(draftView.amountInWords).toBe('One lakh ninety-four thousand seven hundred rupees only.');
    const issued = await issue(d.id);
    expect(issued.number).toMatch(/^INV\/2026-27\/0001$/);
    expect(issued).toMatchObject({ status: 'ISSUED', dueDate: '2026-04-25', outstanding: 194_700 });
    const tb = (await viewer.get(`/v1/finance/reports/trial-balance?companyId=${acme}&to=2026-04-30`))
      .body as {
      debit: number;
      credit: number;
      rows: { code: string; debit: number; credit: number }[];
    };
    expect(tb.debit).toBe(tb.credit);
    const row = (code: string) => tb.rows.find((r) => r.code === code);
    expect(row('1200')).toMatchObject({ debit: 194_700 });
    expect(row('4000')).toMatchObject({ credit: 165_000 });
    expect(row('2310')).toMatchObject({ credit: 14_850 });
    expect(row('2320')).toMatchObject({ credit: 14_850 });
    // issued invoices are final
    expect(
      (
        await accountant.send('put', `${S}/documents/${d.id}`, {
          customerId: pune,
          date: '2026-04-11',
          lines,
        })
      ).body.code,
    ).toBe('DOCUMENT_LOCKED');
    expect((await accountant.send('post', `${S}/documents/${d.id}/cancel`)).body.code).toBe(
      'DOCUMENT_LOCKED',
    );
  });

  it('charge IGST to another state', async () => {
    const c = await accountant.send('post', `${S}/customers`, {
      name: 'Bluebird Foods',
      gstin: '29AABCU9603R1ZX',
    });
    bengaluru = c.body.id as string;
    const d = await draft(bengaluru, '2026-04-12');
    expect(await get(d.id)).toMatchObject({ cgst: 0, sgst: 0, igst: 29_700, total: 194_700 });
    const issued = await issue(d.id);
    expect(issued.number).toBe('INV/2026-27/0002');
  });

  it('numbers quotations apart and turns them into invoices', async () => {
    const q = await draft(pune, '2026-04-13', 'QUOTATION');
    const issued = await issue(q.id);
    expect(issued.number).toBe('QTN/2026-27/0001');
    const inv = await accountant.send('post', `${S}/documents/${q.id}/invoice`);
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expect(inv.body).toMatchObject({ type: 'INVOICE', status: 'DRAFT', total: 194_700, relatedId: q.id });
    // no accounting for a quotation
    const tb = (await viewer.get(`/v1/finance/reports/trial-balance?companyId=${acme}&to=2026-04-30`)).body;
    expect(tb.debit).toBe(tb.credit);
  });
});

describe('receipts', () => {
  it('settle the oldest invoices first and post to the bank', async () => {
    const part = await accountant.send('post', `${S}/receipts`, {
      companyId: acme,
      customerId: pune,
      date: '2026-04-20',
      amount: 100_000,
      mode: 'BANK',
      reference: 'UTR123',
      depositAccountId: bank,
    });
    expect(part.status, JSON.stringify(part.body)).toBe(201);
    expect(part.body).toMatchObject({ number: 'RCT/2026-27/0001', allocated: 100_000 });
    const list = (await viewer.get(`${S}/documents?companyId=${acme}&type=INVOICE&status=OPEN`)).body as {
      number: string;
      status: string;
      outstanding: number;
    }[];
    expect(list.find((d) => d.number === 'INV/2026-27/0001')).toMatchObject({
      status: 'PARTIALLY_PAID',
      outstanding: 94_700,
    });

    const rest = await accountant.send('post', `${S}/receipts`, {
      companyId: acme,
      customerId: pune,
      date: '2026-04-22',
      amount: 120_000,
      mode: 'UPI',
      depositAccountId: bank,
    });
    expect(rest.body).toMatchObject({ allocated: 94_700 });
    const paid = (await viewer.get(`${S}/documents?companyId=${acme}&type=INVOICE&status=PAID`)).body as {
      number: string;
    }[];
    expect(paid.map((p) => p.number)).toEqual(['INV/2026-27/0001']);
    const receipts = (await viewer.get(`${S}/receipts?companyId=${acme}&customerId=${pune}`)).body as {
      unallocated: number;
    }[];
    expect(receipts.map((r) => r.unallocated).sort((a, b) => a - b)).toEqual([0, 25_300]);
  });

  it('refuse to pay an invoice more than it is owed', async () => {
    const all = (await viewer.get(`${S}/documents?companyId=${acme}&type=INVOICE&customerId=${bengaluru}`))
      .body as { id: string }[];
    const res = await accountant.send('post', `${S}/receipts`, {
      companyId: acme,
      customerId: bengaluru,
      date: '2026-04-23',
      amount: 300_000,
      mode: 'BANK',
      depositAccountId: bank,
      allocations: [{ documentId: all[0]!.id, amount: 250_000 }],
    });
    expect(res.body.code).toBe('OVER_ALLOCATED');
  });
});

describe('credit notes and reports', () => {
  it('correct an issued invoice and reduce what is owed', async () => {
    const all = (await viewer.get(`${S}/documents?companyId=${acme}&type=INVOICE&customerId=${bengaluru}`))
      .body as { id: string }[];
    const cn = await accountant.send('post', `${S}/documents/${all[0]!.id}/credit-note`);
    expect(cn.status, JSON.stringify(cn.body)).toBe(201);
    const issued = await issue(cn.body.id as string);
    expect(issued.number).toBe('CN/2026-27/0001');
    expect(await get(all[0]!.id)).toMatchObject({ settled: 194_700, status: 'PAID', outstanding: 0 });
    const tb = (await viewer.get(`/v1/finance/reports/trial-balance?companyId=${acme}&to=2026-04-30`)).body;
    expect(tb.debit).toBe(tb.credit);
  });

  it('give a statement that agrees with the receivables account', async () => {
    const st = (
      await viewer.get(`${S}/customers/${pune}/statement?companyId=${acme}&from=2026-04-01&to=2026-04-30`)
    ).body as { closing: number; rows: unknown[] };
    // invoice 194,700 - receipts 220,000 = -25,300 (customer is in credit)
    expect(st.closing).toBe(-25_300);
    const ageing = (await viewer.get(`${S}/ageing?companyId=${acme}&asOf=2026-05-30`)).body;
    expect(ageing.totals.total).toBe(0);
    const summary = (await viewer.get(`${S}/summary?companyId=${acme}`)).body;
    expect(summary).toMatchObject({ outstanding: 0, drafts: 2 });
  });

  it('keeps viewers from writing', async () => {
    expect((await viewer.send('post', `${S}/customers`, { name: 'Nope' })).status).toBe(403);
  });
});
