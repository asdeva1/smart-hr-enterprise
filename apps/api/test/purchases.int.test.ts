/**
 * Purchases and payables through the real API and database: vendor bills with input GST and TDS, posting to
 * the books, payments that settle the oldest bills first, debit notes, vendor ageing and the vendor ledger.
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
let expense: string;
let local: string;
let faraway: string;

const P = '/v1/finance/purchases';

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

const lines = () => [
  {
    description: 'Packaging services',
    hsn: '998549',
    quantity: 1,
    rate: 100_000,
    gstRate: 18,
    accountId: expense,
  },
];
const draft = async (vendorId: string, date: string, extra: object = {}) => {
  const res = await accountant.send('post', `${P}/bills`, {
    companyId: acme,
    vendorId,
    date,
    vendorBillNo: 'PK-2291',
    lines: lines(),
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string };
};
const post = async (id: string) => {
  const res = await accountant.send('post', `${P}/bills/${id}/post`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { number: string; status: string; dueDate: string; outstanding: number };
};
const get = async (id: string) => (await accountant.get(`${P}/bills/${id}`)).body as Record<string, unknown>;

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  tenantId = (await fx.tenant('Purchases')).id;
  acme = (await fx.company(tenantId, 'ACME')).id;
  accountant = await login('pur-accountant', [
    'finance.view',
    'finance.manage',
    'finance.configure',
    'vendors.view',
    'vendors.manage',
  ]);
  viewer = await login('pur-viewer', ['finance.view']);
  const chart = (await accountant.get(`/v1/finance/accounts?companyId=${acme}`)).body as {
    id: string;
    code: string;
  }[];
  bank = chart.find((a) => a.code === '1100')!.id;
  expense = chart.find((a) => a.code === '5300')!.id;
  const a = await accountant.send('post', '/v1/vendors', {
    code: 'V-ORCHID',
    name: 'Orchid Packaging',
    gstin: '27AAPFU0939F1ZV',
    paymentTermsDays: 30,
  });
  expect(a.status, JSON.stringify(a.body)).toBe(201);
  local = a.body.id as string;
  const b = await accountant.send('post', '/v1/vendors', {
    code: 'V-SKY',
    name: 'Skyline Cloud',
    gstin: '29AABCU9603R1ZX',
    paymentTermsDays: 15,
  });
  faraway = b.body.id as string;
  await accountant.send('put', `/v1/finance/sales/settings/${acme}`, { gstin: '27AAPFU0939F1ZV' });
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await runtime.$disconnect();
  await db.$disconnect();
});

describe('bills', () => {
  it('split input GST, hold back TDS, and post to the books', async () => {
    const d = await draft(local, '2026-04-10', { tdsRate: 2 });
    expect(await get(d.id)).toMatchObject({
      subtotal: 100_000,
      cgst: 9_000,
      sgst: 9_000,
      total: 118_000,
      tdsAmount: 2_000,
      payable: 116_000,
    });
    const posted = await post(d.id);
    expect(posted).toMatchObject({
      number: 'BILL/2026-27/0001',
      status: 'POSTED',
      dueDate: '2026-05-10',
      outstanding: 116_000,
    });
    const tb = (await viewer.get(`/v1/finance/reports/trial-balance?companyId=${acme}&to=2026-04-30`))
      .body as {
      debit: number;
      credit: number;
      rows: { code: string; debit: number; credit: number }[];
    };
    expect(tb.debit).toBe(tb.credit);
    const row = (code: string) => tb.rows.find((r) => r.code === code);
    expect(row('5300')).toMatchObject({ debit: 100_000 });
    expect(row('1410')).toMatchObject({ debit: 9_000 });
    expect(row('1420')).toMatchObject({ debit: 9_000 });
    expect(row('2000')).toMatchObject({ credit: 116_000 });
    expect(row('2250')).toMatchObject({ credit: 2_000 });
    expect(
      (
        await accountant.send('put', `${P}/bills/${d.id}`, {
          vendorId: local,
          date: '2026-04-11',
          lines: lines(),
        })
      ).body.code,
    ).toBe('DOCUMENT_LOCKED');
    expect((await accountant.send('post', `${P}/bills/${d.id}/cancel`)).body.code).toBe('DOCUMENT_LOCKED');
  });

  it('charge input IGST for another state', async () => {
    const d = await draft(faraway, '2026-04-12');
    expect(await get(d.id)).toMatchObject({ cgst: 0, sgst: 0, igst: 18_000, total: 118_000, tdsAmount: 0 });
    expect((await post(d.id)).number).toBe('BILL/2026-27/0002');
  });
});

describe('payments', () => {
  it('settle the oldest bills first and post to the bank', async () => {
    const part = await accountant.send('post', `${P}/payments`, {
      companyId: acme,
      vendorId: local,
      date: '2026-04-20',
      amount: 50_000,
      mode: 'BANK',
      reference: 'UTR9',
      paidFromAccountId: bank,
    });
    expect(part.status, JSON.stringify(part.body)).toBe(201);
    expect(part.body).toMatchObject({ number: 'PAY/2026-27/0001', allocated: 50_000 });
    const open = (await viewer.get(`${P}/bills?companyId=${acme}&status=OPEN`)).body as {
      number: string;
      status: string;
      outstanding: number;
    }[];
    expect(open.find((b) => b.number === 'BILL/2026-27/0001')).toMatchObject({
      status: 'PARTIALLY_PAID',
      outstanding: 66_000,
    });
    const rest = await accountant.send('post', `${P}/payments`, {
      companyId: acme,
      vendorId: local,
      date: '2026-04-25',
      amount: 70_000,
      mode: 'UPI',
      paidFromAccountId: bank,
    });
    expect(rest.body).toMatchObject({ allocated: 66_000 });
    const paid = (await viewer.get(`${P}/bills?companyId=${acme}&status=PAID`)).body as { number: string }[];
    expect(paid.map((b) => b.number)).toEqual(['BILL/2026-27/0001']);
  });

  it('refuse to pay a bill more than it is owed', async () => {
    const all = (await viewer.get(`${P}/bills?companyId=${acme}&vendorId=${faraway}`)).body as {
      id: string;
    }[];
    const res = await accountant.send('post', `${P}/payments`, {
      companyId: acme,
      vendorId: faraway,
      date: '2026-04-26',
      amount: 300_000,
      mode: 'BANK',
      paidFromAccountId: bank,
      allocations: [{ billId: all[0]!.id, amount: 250_000 }],
    });
    expect(res.body.code).toBe('OVER_ALLOCATED');
  });
});

describe('debit notes and reports', () => {
  it('correct a posted bill and reduce what is owed', async () => {
    const all = (await viewer.get(`${P}/bills?companyId=${acme}&vendorId=${faraway}`)).body as {
      id: string;
    }[];
    const dn = await accountant.send('post', `${P}/bills/${all[0]!.id}/debit-note`);
    expect(dn.status, JSON.stringify(dn.body)).toBe(201);
    expect((await post(dn.body.id as string)).number).toBe('DN/2026-27/0001');
    expect(await get(all[0]!.id)).toMatchObject({ settled: 118_000, status: 'PAID', outstanding: 0 });
    const tb = (await viewer.get(`/v1/finance/reports/trial-balance?companyId=${acme}&to=2026-04-30`)).body;
    expect(tb.debit).toBe(tb.credit);
  });

  it('agree with the payables account', async () => {
    const st = (
      await viewer.get(`${P}/vendors/${local}/statement?companyId=${acme}&from=2026-04-01&to=2026-04-30`)
    ).body as { closing: number };
    // bill 116,000 payable - payments 120,000 = 4,000 paid in advance
    expect(st.closing).toBe(-4_000);
    expect((await viewer.get(`${P}/ageing?companyId=${acme}&asOf=2026-06-30`)).body.totals.total).toBe(0);
    expect((await viewer.get(`${P}/summary?companyId=${acme}`)).body).toMatchObject({
      outstanding: 0,
      drafts: 0,
    });
  });

  it('keeps viewers from writing', async () => {
    expect((await viewer.send('post', `${P}/payments`, { companyId: acme })).status).toBe(403);
  });
});
