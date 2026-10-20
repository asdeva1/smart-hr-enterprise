import { describe, expect, it } from 'vitest';
import {
  balanceSheet,
  journalProblems,
  ledger,
  openingBalance,
  profitAndLoss,
  trialBalance,
  type AccountRef,
} from './ledger-calc.js';

const accounts: AccountRef[] = [
  { id: 'bank', code: '1100', name: 'Bank', type: 'ASSET' },
  { id: 'capital', code: '3000', name: 'Capital', type: 'EQUITY' },
  { id: 'payable', code: '2100', name: 'Salaries payable', type: 'LIABILITY' },
  { id: 'sales', code: '4000', name: 'Sales', type: 'INCOME' },
  { id: 'salary', code: '5000', name: 'Salaries', type: 'EXPENSE' },
];

const lines = [
  { accountId: 'bank', date: '2026-04-01', debit: 100_000, credit: 0 },
  { accountId: 'capital', date: '2026-04-01', debit: 0, credit: 100_000 },
  { accountId: 'bank', date: '2026-04-15', debit: 50_000.1, credit: 0 },
  { accountId: 'sales', date: '2026-04-15', debit: 0, credit: 50_000.1 },
  { accountId: 'salary', date: '2026-04-30', debit: 30_000, credit: 0 },
  { accountId: 'payable', date: '2026-04-30', debit: 0, credit: 30_000 },
  { accountId: 'payable', date: '2026-05-01', debit: 30_000, credit: 0 },
  { accountId: 'bank', date: '2026-05-01', debit: 0, credit: 30_000 },
];

describe('journals', () => {
  it('must balance to the paisa, have two lines, and one side per line', () => {
    expect(
      journalProblems([
        { accountId: 'a', debit: 0.1, credit: 0 },
        { accountId: 'b', debit: 0.2, credit: 0 },
        { accountId: 'c', debit: 0, credit: 0.3 },
      ]),
    ).toEqual([]);
    expect(journalProblems([{ accountId: 'a', debit: 10, credit: 0 }])).toContain(
      'A journal needs at least two lines',
    );
    expect(
      journalProblems([
        { accountId: 'a', debit: 10, credit: 10 },
        { accountId: 'b', debit: 0, credit: 0 },
      ]),
    ).toEqual(['Line 1: enter either a debit or a credit', 'Line 2: enter either a debit or a credit']);
    expect(
      journalProblems([
        { accountId: 'a', debit: 10, credit: 0 },
        { accountId: 'b', debit: 0, credit: 9.99 },
      ])[0],
    ).toMatch(/must be equal/);
  });
});

describe('reports', () => {
  it('trial balance totals agree', () => {
    const tb = trialBalance(accounts, lines);
    expect(tb.debit).toBe(tb.credit);
    expect(tb.rows.find((r) => r.id === 'bank')).toMatchObject({ debit: 120_000.1, credit: 0 });
    // Paid off, so salaries payable isn't listed.
    expect(tb.rows.map((r) => r.id)).not.toContain('payable');
  });

  it('profit and loss, and a balance sheet that balances with current earnings', () => {
    const pl = profitAndLoss(accounts, lines);
    expect(pl).toMatchObject({ income: { total: 50_000.1 }, expenses: { total: 30_000 }, profit: 20_000.1 });
    const bs = balanceSheet(accounts, lines);
    expect(bs.assets.total).toBe(120_000.1);
    expect(bs.equity).toMatchObject({ currentEarnings: 20_000.1, total: 120_000.1 });
    expect(bs.balanced).toBe(true);
  });

  it('ledger runs a balance from the opening', () => {
    const before = lines.filter((l) => l.accountId === 'bank' && l.date < '2026-04-10');
    const opening = openingBalance('ASSET', before);
    expect(opening).toBe(100_000);
    const after = lines
      .filter((l) => l.accountId === 'bank' && l.date >= '2026-04-10')
      .map((l, i) => ({ ...l, id: String(i) }));
    const l = ledger('ASSET', opening, after);
    expect(l.rows.map((r) => r.balance)).toEqual([150_000.1, 120_000.1]);
    expect(
      ledger(
        'LIABILITY',
        0,
        lines.filter((x) => x.accountId === 'payable').map((x, i) => ({ ...x, id: String(i) })),
      ).closing,
    ).toBe(0);
  });
});
