/**
 * Bank reconciliation through the real API and database: importing a statement once, matching its lines to
 * posted journals, refusing wrong matches (amount, direction, account, unposted, taken), automatic matching
 * only when unambiguous, the reconciliation summary, permissions, and tenant isolation.
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
let owner: Browser;
let accountant: Browser;
let viewer: Browser;
let other: Browser;
let acme: string;
let acct: Record<string, string> = {};
let accountId: string;

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

async function postJournal(date: string, narration: string, lines: [string, number, number][]) {
  const draft = await accountant.send('post', '/v1/finance/journals', {
    companyId: acme,
    date,
    narration,
    lines: lines.map(([code, debit, credit]) => ({ accountId: acct[code]!, debit, credit })),
  });
  expect(draft.status, JSON.stringify(draft.body)).toBe(201);
  const sent = await accountant.send('post', `/v1/finance/journals/${draft.body.id}/submit`);
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  const inbox = (await owner.get('/v1/approvals/inbox')).body as { id: string; request: { id: string } }[];
  const task = inbox.find((t) => t.request.id === sent.body.approvalRequestId)!;
  expect(
    (await owner.send('post', `/v1/approvals/tasks/${task.id}/decision`, { decision: 'APPROVE' })).status,
  ).toBe(200);
  return draft.body.id as string;
}

/** The journal line on the bank account of a posted journal. */
async function bankLineOf(entryId: string) {
  const line = await db.journalLine.findFirstOrThrow({ where: { entryId, accountId } });
  return line.id;
}

const stmt = (lines: object[], extra: object = {}) => ({
  companyId: acme,
  accountId,
  fileName: 'april.csv',
  lines,
  ...extra,
});

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  const tenant = await fx.tenant('Bank');
  tenantId = tenant.id;
  const ownerUser = await fx.user('bank-owner');
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  acme = (await fx.company(tenantId, 'ACME')).id;
  accountant = await login('bank-accountant', ['finance.view', 'finance.manage', 'finance.configure']);
  viewer = await login('bank-viewer', ['finance.view']);

  const chart = (await accountant.get(`/v1/finance/accounts?companyId=${acme}`)).body as {
    id: string;
    code: string;
  }[];
  acct = Object.fromEntries(chart.map((a) => [a.code, a.id]));
  const charges = await accountant.send('post', '/v1/finance/accounts', {
    companyId: acme,
    code: '5900',
    name: 'Bank charges',
    type: 'EXPENSE',
  });
  acct['5900'] = charges.body.id as string;
  accountId = acct['1100']!;

  const t2 = await fx.tenant('Bank Other');
  const o2 = await fx.user('bank-other-owner');
  await fx.member(t2.id, o2.id, true);
  other = new Browser(app);
  expect((await other.login(o2.email)).status).toBe(200);
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await runtime.$disconnect();
  await db.$disconnect();
});

describe('bank reconciliation', () => {
  let capital: string;
  let supplier: string;
  let chargeEntry: string;
  let statementId: string;

  it('lists the accounts that can be reconciled, bank first', async () => {
    const res = await viewer.get(`/v1/finance/bank/accounts?companyId=${acme}`);
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ code: '1100', isBank: true });
    expect(res.body.every((a: { code: string }) => !['2000', '4000'].includes(a.code))).toBe(true);
  });

  it('imports a statement once and skips lines that were imported before', async () => {
    capital = await postJournal('2026-04-01', 'Capital introduced', [
      ['1100', 100000, 0],
      ['3000', 0, 100000],
    ]);
    supplier = await postJournal('2026-04-05', 'Paid supplier', [
      ['5900', 2500, 0],
      ['1100', 0, 2500],
    ]);
    chargeEntry = await postJournal('2026-04-06', 'Another 118 payment', [
      ['5900', 118, 0],
      ['1100', 0, 118],
    ]);
    await postJournal('2026-04-07', 'Second 118 payment', [
      ['5900', 118, 0],
      ['1100', 0, 118],
    ]);

    const lines = [
      { date: '2026-04-01', description: 'NEFT capital', deposit: 100000, balance: 100000 },
      { date: '2026-04-05', description: 'Cheque 114', reference: '114', withdrawal: 2500, balance: 97500 },
      { date: '2026-04-06', description: 'Charges', withdrawal: 118, balance: 97382 },
      { date: '2026-04-08', description: 'Interest', deposit: 40, balance: 97422 },
    ];
    expect((await viewer.send('post', '/v1/finance/bank/statements', stmt(lines))).status).toBe(403);
    const first = await accountant.send(
      'post',
      '/v1/finance/bank/statements',
      stmt(lines, { openingBalance: 0, closingBalance: 97422 }),
    );
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toMatchObject({ imported: 4, duplicates: 0 });
    statementId = first.body.statementId;

    const again = await accountant.send('post', '/v1/finance/bank/statements', stmt(lines));
    expect(again.body.code).toBe('ALREADY_IMPORTED');

    const overlap = await accountant.send(
      'post',
      '/v1/finance/bank/statements',
      stmt([...lines, { date: '2026-04-09', description: 'Fee', withdrawal: 10, balance: 97412 }]),
    );
    expect(overlap.body).toMatchObject({ imported: 1, duplicates: 4 });
    expect(
      (await accountant.get(`/v1/finance/bank/statements?companyId=${acme}&accountId=${accountId}`)).body,
    ).toHaveLength(2);
  });

  it('refuses lines that are neither a deposit nor a withdrawal, and non-bank accounts', async () => {
    const bad = await accountant.send(
      'post',
      '/v1/finance/bank/statements',
      stmt([{ date: '2026-04-01', description: 'x', deposit: 5, withdrawal: 5 }]),
    );
    expect(bad.status).toBe(400);
    const wrong = await accountant.send('post', '/v1/finance/bank/statements', {
      ...stmt([{ date: '2026-04-01', description: 'x', deposit: 5 }]),
      accountId: acct['4000'],
    });
    expect(wrong.body.code).toBe('NOT_A_BANK_ACCOUNT');
  });

  it('suggests the right entry, and matches only the same amount and direction', async () => {
    const lines = (
      await viewer.get(`/v1/finance/bank/lines?companyId=${acme}&accountId=${accountId}&status=UNMATCHED`)
    ).body as { id: string; description: string; suggestions: { journalLineId: string }[] }[];
    const cap = lines.find((l) => l.description === 'NEFT capital')!;
    expect(cap.suggestions.map((s) => s.journalLineId)).toEqual([await bankLineOf(capital)]);

    // Wrong direction: the cheque (withdrawal 2,500) against the capital deposit entry.
    const cheque = lines.find((l) => l.description === 'Cheque 114')!;
    const wrong = await accountant.send('post', `/v1/finance/bank/lines/${cheque.id}/match`, {
      journalLineId: await bankLineOf(capital),
    });
    expect(wrong.body.code).toBe('AMOUNT_MISMATCH');
    expect(
      (
        await viewer.send('post', `/v1/finance/bank/lines/${cheque.id}/match`, {
          journalLineId: await bankLineOf(supplier),
        })
      ).status,
    ).toBe(403);
    const ok = await accountant.send('post', `/v1/finance/bank/lines/${cheque.id}/match`, {
      journalLineId: await bankLineOf(supplier),
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    // The same entry cannot be taken twice.
    const twin = lines.find((l) => l.description === 'Charges')!;
    expect(
      (
        await accountant.send('post', `/v1/finance/bank/lines/${twin.id}/match`, {
          journalLineId: await bankLineOf(supplier),
        })
      ).body.code,
    ).toBe('AMOUNT_MISMATCH');
  });

  it('auto-matches the unambiguous line and leaves the two equal 118 payments to a person', async () => {
    const res = await accountant.send('post', '/v1/finance/bank/auto-match', { companyId: acme, accountId });
    expect(res.status).toBe(200);
    // The capital deposit is unambiguous; the 118 charge has two possible entries; interest has none.
    expect(res.body.matched).toBe(1);
    const lines = (await viewer.get(`/v1/finance/bank/lines?companyId=${acme}&accountId=${accountId}`))
      .body as {
      id: string;
      description: string;
      status: string;
      suggestions: unknown[];
    }[];
    const byDesc = Object.fromEntries(lines.map((l) => [l.description, l]));
    expect(byDesc['NEFT capital']!.status).toBe('MATCHED');
    expect(byDesc['Charges']!.status).toBe('UNMATCHED');
    expect(byDesc['Charges']!.suggestions).toHaveLength(2);

    const picked = await accountant.send('post', `/v1/finance/bank/lines/${byDesc['Charges']!.id}/match`, {
      journalLineId: await bankLineOf(chargeEntry),
    });
    expect(picked.status).toBe(200);
  });

  it('shows what is in the books but not the bank, and what is on the bank but not in the books', async () => {
    const items = (await viewer.get(`/v1/finance/bank/book-items?companyId=${acme}&accountId=${accountId}`))
      .body as { credit: number; narration: string }[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ credit: 118, narration: 'Second 118 payment' });

    const s = (
      await viewer.get(`/v1/finance/bank/summary?companyId=${acme}&accountId=${accountId}&asOf=2026-04-30`)
    ).body;
    // Books: 100,000 − 2,500 − 118 − 118 = 97,264. Bank: 97,422 closing.
    expect(s.bookBalance).toBe(97264);
    expect(s.statementBalance).toBe(97422);
    // Bank shows 40 interest and a 10 fee the books lack.
    expect(s.bankOnly).toMatchObject({ count: 2, deposits: 40, withdrawals: 10 });
    expect(s.bookOnly).toMatchObject({ count: 1, uncleared: 118, inTransit: 0 });
    // Adjusted bank 97,422 − 118 = 97,304; adjusted book 97,264 + 40 − 10 = 97,294.
    expect(s.adjustedBank).toBe(97304);
    expect(s.adjustedBook).toBe(97294);
    expect(s.reconciled).toBe(false);
  });

  it('sets a line aside, returns it, and can unmatch', async () => {
    const lines = (
      await viewer.get(`/v1/finance/bank/lines?companyId=${acme}&accountId=${accountId}&status=UNMATCHED`)
    ).body as { id: string; description: string }[];
    const fee = lines.find((l) => l.description === 'Fee')!;
    expect(
      (
        await accountant.send('post', `/v1/finance/bank/lines/${fee.id}/ignore`, {
          note: 'Reversed next day',
        })
      ).body.status,
    ).toBe('IGNORED');
    expect((await accountant.send('post', `/v1/finance/bank/lines/${fee.id}/unmatch`)).body.status).toBe(
      'UNMATCHED',
    );

    const matched = (
      await viewer.get(`/v1/finance/bank/lines?companyId=${acme}&accountId=${accountId}&status=MATCHED`)
    ).body as { id: string }[];
    expect(matched).toHaveLength(3);
    expect(
      (await accountant.send('post', `/v1/finance/bank/lines/${matched[0]!.id}/unmatch`)).body.status,
    ).toBe('UNMATCHED');
  });

  it('is private to its organisation, and the database holds the line on its own', async () => {
    expect(
      (await other.get(`/v1/finance/bank/lines?companyId=${acme}&accountId=${accountId}`)).status,
    ).toBeGreaterThanOrEqual(403);
    const lines = await db.bankStatementLine.findMany({ where: { tenantId } });
    expect(lines.length).toBeGreaterThan(0);
    // A match the rules forbid is refused by the database itself.
    const deposit = lines.find((l) => Number(l.deposit) > 0 && l.status !== 'MATCHED')!;
    const wrongLine = await db.journalLine.findFirstOrThrow({ where: { accountId, credit: { gt: 0 } } });
    await expect(
      db.bankStatementLine.update({
        where: { id: deposit.id },
        data: { status: 'MATCHED', journalLineId: wrongLine.id },
      }),
    ).rejects.toThrow(/does not match the bank line/);
    expect(statementId).toBeTruthy();
  });
});
