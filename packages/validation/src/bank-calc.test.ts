import { describe, expect, it } from 'vitest';
import {
  autoMatch,
  bankDedupeKeys,
  candidatesFor,
  parseBankAmount,
  parseBankCsv,
  parseBankDate,
} from './bank-calc.js';

describe('bank dates and amounts', () => {
  it('reads the formats banks use', () => {
    expect(parseBankDate('31/12/2026')).toBe('2026-12-31');
    expect(parseBankDate('05-01-26')).toBe('2026-01-05');
    expect(parseBankDate('5 Mar 2026')).toBe('2026-03-05');
    expect(parseBankDate('2026-03-05')).toBe('2026-03-05');
    expect(parseBankDate('31/02/2026')).toBeNull();
    expect(parseBankDate('Total')).toBeNull();
  });
  it('reads amounts with commas, brackets, Dr and Cr', () => {
    expect(parseBankAmount('1,23,456.50')).toBe(123456.5);
    expect(parseBankAmount('(500.00)')).toBe(-500);
    expect(parseBankAmount('500 Dr')).toBe(-500);
    expect(parseBankAmount('500 Cr')).toBe(500);
    expect(parseBankAmount('₹ 12')).toBe(12);
    expect(parseBankAmount('')).toBeNull();
    expect(parseBankAmount('abc')).toBeNaN();
  });
});

describe('reading a statement', () => {
  const csv = [
    'Account Statement,,,,',
    'Txn Date,Narration,Chq/Ref No,Withdrawal Amt,Deposit Amt,Balance',
    '01/04/2026,"NEFT-ACME, PAYMENT",N123,,"1,00,000.00","1,50,000.00"',
    '02/04/2026,Bank charges,,118.00,,"1,49,882.00"',
    '02/04/2026,Bank charges,,118.00,,"1,49,764.00"',
    ',,,,,',
    'Closing balance,,,,,',
  ].join('\n');
  it('maps credit to deposit and debit to withdrawal, and finds the balances', () => {
    const r = parseBankCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.lines).toHaveLength(3);
    expect(r.lines[0]).toMatchObject({
      date: '2026-04-01',
      deposit: 100000,
      withdrawal: 0,
      reference: 'N123',
    });
    expect(r.lines[1]).toMatchObject({ withdrawal: 118, deposit: 0 });
    expect(r.openingBalance).toBe(50000);
    expect(r.closingBalance).toBe(149764);
  });
  it('accepts one signed Amount column and semicolons', () => {
    const r = parseBankCsv('Date;Description;Amount\n01-04-2026;Salary;-5000\n02-04-2026;Sale;7000');
    expect(r.errors).toEqual([]);
    expect(r.lines.map((l) => [l.deposit, l.withdrawal])).toEqual([
      [0, 5000],
      [7000, 0],
    ]);
  });
  it('names the row that is wrong and imports nothing silently', () => {
    const r = parseBankCsv('Date,Narration,Debit,Credit\n01/04/2026,A,10,20\n31/13/2026,B,5,\n');
    expect(r.errors.join(' ')).toMatch(/Row 2: needs either/);
    expect(r.errors.join(' ')).toMatch(/Row 3: “31\/13\/2026” is not a date/);
  });
  it('refuses a file with no header', () => {
    expect(parseBankCsv('hello,world').errors[0]).toMatch(/header row/);
  });
  it('keeps identical lines in one file but recognises a re-import', () => {
    const a = parseBankCsv(csv).lines;
    const k1 = bankDedupeKeys(a);
    expect(new Set(k1).size).toBe(3);
    expect(bankDedupeKeys(a)).toEqual(k1);
  });
});

describe('matching', () => {
  const entries = [
    { id: 'j1', date: '2026-04-02', debit: 0, credit: 118 },
    { id: 'j2', date: '2026-04-03', debit: 0, credit: 118 },
    { id: 'j3', date: '2026-04-01', debit: 100000, credit: 0 },
  ];
  it('finds same amount and direction near the date, nearest first', () => {
    const c = candidatesFor({ id: 'l', date: '2026-04-02', deposit: 0, withdrawal: 118 }, entries);
    expect(c.map((x) => x.id)).toEqual(['j1', 'j2']);
    expect(candidatesFor({ id: 'l', date: '2026-04-02', deposit: 118, withdrawal: 0 }, entries)).toEqual([]);
    expect(candidatesFor({ id: 'l', date: '2026-05-20', deposit: 0, withdrawal: 118 }, entries)).toEqual([]);
  });
  it('auto-matches only the unambiguous', () => {
    const lines = [
      { id: 'a', date: '2026-04-01', deposit: 100000, withdrawal: 0 },
      { id: 'b', date: '2026-04-02', deposit: 0, withdrawal: 118 },
    ];
    const m = autoMatch(lines, entries);
    expect(m.get('a')).toBe('j3');
    expect(m.has('b')).toBe(false); // two possible entries, a person decides
  });
  it('does not give one entry to two lines', () => {
    const lines = [
      { id: 'a', date: '2026-04-01', deposit: 100000, withdrawal: 0 },
      { id: 'b', date: '2026-04-02', deposit: 100000, withdrawal: 0 },
    ];
    expect(autoMatch(lines, entries).size).toBe(0);
  });
});
