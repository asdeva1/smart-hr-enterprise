/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
/**
 * GST and TDS returns through the real API and database: GSTR-1 sections and HSN summary, the GSTR-3B style
 * summary, the purchase register, GSTR-2B reconciliation and the TDS report.
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
let nobody: Browser;
let acme: string;
let expense: string;

const S = '/v1/finance/sales';
const P = '/v1/finance/purchases';
const G = '/v1/finance/gst';
const Q = () => `companyId=${acme}&from=2026-04-01&to=2026-04-30`;

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

const customer = async (body: object) => {
  const res = await accountant.send('post', `${S}/customers`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
};
const invoice = async (customerId: string, date: string, lines: object[]) => {
  const d = await accountant.send('post', `${S}/documents`, {
    companyId: acme,
    customerId,
    type: 'INVOICE',
    date,
    lines,
  });
  expect(d.status, JSON.stringify(d.body)).toBe(201);
  const i = await accountant.send('post', `${S}/documents/${d.body.id}/issue`);
  expect(i.status, JSON.stringify(i.body)).toBe(200);
  return d.body.id as string;
};
const bill = async (vendorId: string, vendorBillNo: string, rate: number, tdsRate = 0) => {
  const d = await accountant.send('post', `${P}/bills`, {
    companyId: acme,
    vendorId,
    date: '2026-04-10',
    vendorBillNo,
    tdsRate,
    lines: [{ description: 'Services', hsn: '998549', quantity: 1, rate, gstRate: 18, accountId: expense }],
  });
  expect(d.status, JSON.stringify(d.body)).toBe(201);
  expect((await accountant.send('post', `${P}/bills/${d.body.id}/post`)).status).toBe(200);
};

const service = (hsn: string, rate: number) => ({
  description: 'Work',
  hsn,
  quantity: 1,
  rate,
  gstRate: 18,
});

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  tenantId = (await fx.tenant('Gst')).id;
  acme = (await fx.company(tenantId, 'ACME')).id;
  accountant = await login('gst-accountant', [
    'finance.view',
    'finance.manage',
    'finance.configure',
    'vendors.view',
    'vendors.manage',
  ]);
  viewer = await login('gst-viewer', ['finance.view']);
  nobody = await login('gst-nobody', ['vendors.view']);
  const chart = (await accountant.get(`/v1/finance/accounts?companyId=${acme}`)).body as {
    id: string;
    code: string;
  }[];
  expense = chart.find((a) => a.code === '5300')!.id;
  await accountant.send('put', `${S}/settings/${acme}`, { gstin: '27AAPFU0939F1ZV' });

  const local = await customer({ name: 'Northwind Retail', gstin: '27AAPFU0939F1ZV' });
  const remote = await customer({ name: 'Bengaluru Traders', gstin: '29AABCU9603R1ZX' });
  const shopper = await customer({ name: 'Walk-in local', stateCode: '27' });
  const bigShopper = await customer({ name: 'Walk-in far', stateCode: '29' });
  const first = await invoice(local, '2026-04-05', [service('998314', 100_000), service('998313', 65_000)]);
  await invoice(remote, '2026-04-06', [service('998314', 100_000)]);
  await invoice(shopper, '2026-04-07', [service('998314', 50_000)]);
  await invoice(bigShopper, '2026-04-08', [service('998315', 300_000)]);
  const cn = await accountant.send('post', `${S}/documents/${first}/credit-note`);
  expect(cn.status, JSON.stringify(cn.body)).toBe(201);
  // A credit note starts dated today; move it into the period being returned.
  const draftCn = (await accountant.get(`${S}/documents/${cn.body.id}`)).body as {
    customer: { id: string };
    lines: { description: string; hsn: string; quantity: number; rate: number; gstRate: number }[];
  };
  const moved = await accountant.send('put', `${S}/documents/${cn.body.id}`, {
    customerId: draftCn.customer.id,
    relatedId: first,
    date: '2026-04-20',
    lines: draftCn.lines.map(({ description, hsn, quantity, rate, gstRate }) => ({
      description,
      hsn,
      quantity,
      rate,
      gstRate,
    })),
  });
  expect(moved.status, JSON.stringify(moved.body)).toBe(200);
  expect((await accountant.send('post', `${S}/documents/${cn.body.id}/issue`)).status).toBe(200);

  const orchid = await accountant.send('post', '/v1/vendors', {
    code: 'V-ORCHID',
    name: 'Orchid Packaging',
    gstin: '27AAPFU0939F1ZV',
    pan: 'AAPFU0939F',
  });
  const sky = await accountant.send('post', '/v1/vendors', {
    code: 'V-SKY',
    name: 'Skyline Cloud',
    gstin: '29AABCU9603R1ZX',
  });
  await bill(orchid.body.id as string, 'PK-2291', 100_000, 2);
  await bill(sky.body.id as string, 'SK-77', 40_000);
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await runtime.$disconnect();
  await db.$disconnect();
});

describe('GSTR-1', () => {
  it('sorts sales into B2B, B2CL, B2CS and credit notes', async () => {
    const res = await viewer.get(`${G}/gstr1?${Q()}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = res.body as Record<string, any>;
    expect((r.b2b as { customer: string }[]).map((x) => x.customer)).toEqual([
      'Northwind Retail',
      'Bengaluru Traders',
    ]);
    expect(r.b2b[1]).toMatchObject({ igst: 18_000, cgst: 0 });
    expect(r.b2cl).toHaveLength(1);
    expect(r.b2cl[0]).toMatchObject({ customer: 'Walk-in far', igst: 54_000 });
    expect(r.b2cs).toEqual([expect.objectContaining({ pos: '27', rate: 18, taxable: 50_000, cgst: 4_500 })]);
    expect(r.cdnr).toHaveLength(1);
    expect(r.cdnr[0].against.number).toBe('INV/2026-27/0001');
    expect(r.cdnur).toHaveLength(0);
  });

  it('nets credit notes out of the HSN summary and totals', async () => {
    const r = (await viewer.get(`${G}/gstr1?${Q()}`)).body as { hsn: any[]; totals: any };
    const row = (h: string) => r.hsn.find((x) => x.hsn === h);
    // 100,000 + 100,000 + 50,000 less the credit note for 100,000
    expect(row('998314')).toMatchObject({ taxable: 150_000, rate: 18 });
    expect(row('998313')).toMatchObject({ taxable: 0 });
    expect(row('998315')).toMatchObject({ taxable: 300_000, igst: 54_000 });
    expect(r.totals.net.taxable).toBe(450_000 + 0);
  });

  it('rejects a backwards period', async () => {
    expect((await viewer.get(`${G}/gstr1?companyId=${acme}&from=2026-05-01&to=2026-04-01`)).status).toBe(400);
  });
});

describe('purchases side', () => {
  it('lists the purchase register and the GSTR-3B style summary', async () => {
    const reg = (await viewer.get(`${G}/purchase-register?${Q()}`)).body as { rows: any[]; totals: any };
    expect(reg.rows).toHaveLength(2);
    expect(reg.totals).toMatchObject({ taxable: 140_000, cgst: 9_000, sgst: 9_000, igst: 7_200 });
    const b = (await viewer.get(`${G}/gstr3b?${Q()}`)).body as { heads: any[]; netPayable: number };
    const head = (h: string) => b.heads.find((x) => x.head === h);
    expect(head('igst')).toMatchObject({ output: 72_000, itc: 7_200, payable: 64_800 });
    expect(head('cgst')).toMatchObject({ output: 4_500, itc: 9_000, payable: -4_500 });
    // IGST 64,800 payable, CGST and SGST each 4,500 of credit to carry forward
    expect(b.netPayable).toBe(55_800);
  });

  it('reports TDS by vendor', async () => {
    const t = (await viewer.get(`${G}/tds?${Q()}`)).body as { rows: any[]; total: number };
    expect(t.rows).toEqual([
      expect.objectContaining({
        vendor: expect.objectContaining({ name: 'Orchid Packaging' }),
        rate: 2,
        base: 100_000,
        tds: 2_000,
      }),
    ]);
    expect(t.total).toBe(2_000);
  });
});

describe('GSTR-2B reconciliation', () => {
  const file = (invoices: object[]) => ({
    data: {
      docdata: {
        b2b: [
          { ctin: '27AAPFU0939F1ZV', trdnm: 'Orchid Packaging', inv: invoices.slice(0, 1) },
          { ctin: '29AABCU9603R1ZX', trdnm: 'Skyline Cloud', inv: invoices.slice(1) },
        ],
      },
    },
  });

  it('finds matches, differences and invoices missing on either side', async () => {
    const res = await viewer.send('post', `${G}/gstr2b/reconcile`, {
      companyId: acme,
      from: '2026-04-01',
      to: '2026-04-30',
      data: file([
        { inum: 'PK/2291', dt: '10-04-2026', txval: 100_000, cgst: 9_000, sgst: 9_000 },
        { inum: 'SK-77', dt: '10-04-2026', txval: 40_000, igst: 3_600 },
        { inum: 'SK-80', dt: '12-04-2026', txval: 1_000, igst: 180 },
      ]),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = res.body as { rows: any[]; counts: any };
    expect(r.counts).toEqual({ matched: 1, mismatch: 1, missingInBooks: 1, missingIn2b: 0 });
    expect(r.rows.find((x) => x.number === 'SK-77')).toMatchObject({
      status: 'MISMATCH',
      differences: ['IGST'],
    });
    expect(r.rows.find((x) => x.number === 'SK-80').status).toBe('MISSING_IN_BOOKS');
  });

  it('explains a file it cannot read', async () => {
    const res = await viewer.send('post', `${G}/gstr2b/reconcile`, {
      companyId: acme,
      from: '2026-04-01',
      to: '2026-04-30',
      data: { hello: 'world' },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_GSTR2B');
  });
});

describe('access', () => {
  it('needs finance.view', async () => {
    expect((await nobody.get(`${G}/gstr1?${Q()}`)).status).toBe(403);
  });
});
