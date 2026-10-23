/**
 * Pure rules for bank reconciliation: reading a bank's CSV statement, de-duplication keys, and the matching
 * rule that pairs statement lines with book entries. No database here, so every rule is easy to test.
 */

export interface ParsedBankLine {
  date: string;
  description: string;
  reference: string | null;
  deposit: number;
  withdrawal: number;
  balance: number | null;
}

export interface ParsedBankStatement {
  lines: ParsedBankLine[];
  /** Human-readable problems, each naming the row. The import is refused while there are any. */
  errors: string[];
  openingBalance: number | null;
  closingBalance: number | null;
}

/** Splits CSV text into rows, honouring quotes and an auto-detected delimiter (comma, semicolon or tab). */
export function splitCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const first = clean.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const delimiter = [',', ';', '\t'].reduce((best, d) =>
    first.split(d).length > first.split(best).length ? d : best,
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row.map((x) => x.trim()));
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row.map((x) => x.trim()));
  return rows;
}

/** 31/12/2026, 31-12-2026, 31 Dec 2026 or 2026-12-31 → 2026-12-31; null when it is not a real date. */
export function parseBankDate(value: string): string | null {
  const v = value.trim();
  const valid = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
      ? `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      : null;
  };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(v);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return valid(y, Number(m[2]), Number(m[1]));
  }
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  m = /^(\d{1,2})[ \-]([A-Za-z]{3})[a-z]*[ \-,]+(\d{2}|\d{4})$/.exec(v);
  if (m) {
    const mi = months.indexOf(m[2]!.toLowerCase());
    if (mi < 0) return null;
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return valid(y, mi + 1, Number(m[1]));
  }
  return null;
}

/** "1,23,456.50", "(500.00)", "500 Dr", "₹ 12.00" → a number; null when empty; NaN when unreadable. */
export function parseBankAmount(value: string): number | null {
  let v = value.trim();
  if (v === '' || v === '-') return null;
  let negative = false;
  if (/^\(.*\)$/.test(v)) {
    negative = true;
    v = v.slice(1, -1);
  }
  if (/\bdr\.?$/i.test(v)) negative = true;
  v = v.replace(/\b(dr|cr)\.?$/i, '').replace(/[₹,\s]|rs\.?|inr/gi, '');
  if (v.startsWith('-')) {
    negative = !negative;
    v = v.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(v)) return Number.NaN;
  const n = Math.round(Number(v) * 100) / 100;
  return negative ? -n : n;
}

const HEADERS = {
  date: ['date', 'txn date', 'transaction date', 'value date', 'tran date', 'posting date'],
  description: ['description', 'narration', 'particulars', 'details', 'transaction remarks', 'remarks'],
  reference: ['reference', 'ref no', 'ref', 'cheque no', 'chq no', 'chq/ref no', 'utr', 'transaction id'],
  deposit: [
    'deposit',
    'deposits',
    'credit',
    'credits',
    'cr',
    'deposit amt',
    'deposit amount',
    'credit amount',
  ],
  withdrawal: [
    'withdrawal',
    'withdrawals',
    'debit',
    'debits',
    'dr',
    'withdrawal amt',
    'withdrawal amount',
    'debit amount',
  ],
  amount: ['amount', 'txn amount', 'transaction amount'],
  balance: ['balance', 'closing balance', 'running balance'],
} as const;

/**
 * Reads a bank's statement CSV. The header row names the columns (Date, Narration, Debit/Withdrawal,
 * Credit/Deposit, Balance, or one signed Amount). From the bank's point of view money in is a "credit" and
 * money out a "debit", so Credit becomes our deposit and Debit our withdrawal.
 */
export function parseBankCsv(text: string): ParsedBankStatement {
  const rows = splitCsv(text);
  const errors: string[] = [];
  const empty = { lines: [], errors, openingBalance: null, closingBalance: null };
  const headerAt = rows.findIndex((r) => {
    const names = r.map((c) => c.toLowerCase());
    return HEADERS.date.some((h) => names.includes(h)) && names.length >= 3;
  });
  if (headerAt < 0) {
    errors.push('Could not find the header row. The file needs a Date column and amount columns.');
    return empty;
  }
  const names = rows[headerAt]!.map((c) => c.toLowerCase());
  const col = (key: keyof typeof HEADERS) =>
    names.findIndex((n) => (HEADERS[key] as readonly string[]).includes(n));
  const iDate = col('date');
  const iDesc = col('description');
  const iRef = col('reference');
  const iDep = col('deposit');
  const iWd = col('withdrawal');
  const iAmt = col('amount');
  const iBal = col('balance');
  if (iDesc < 0) errors.push('The file needs a Description or Narration column.');
  if (iAmt < 0 && (iDep < 0 || iWd < 0))
    errors.push('The file needs Debit and Credit columns, or one Amount column.');
  if (errors.length > 0) return empty;

  const lines: ParsedBankLine[] = [];
  for (let r = headerAt + 1; r < rows.length; r++) {
    const row = rows[r]!;
    const n = r + 1;
    const rawDate = row[iDate] ?? '';
    if (rawDate === '' && (row[iDesc] ?? '') === '') continue;
    const date = parseBankDate(rawDate);
    if (!date) {
      // Bank files often end with totals or notes; only complain when the row looks like a transaction.
      if (rawDate !== '' && /\d/.test(rawDate)) errors.push(`Row ${n}: “${rawDate}” is not a date`);
      continue;
    }
    let deposit = 0;
    let withdrawal = 0;
    if (iAmt >= 0) {
      const a = parseBankAmount(row[iAmt] ?? '');
      if (a === null || Number.isNaN(a) || a === 0) {
        errors.push(`Row ${n}: the amount is missing or not a number`);
        continue;
      }
      if (a > 0) deposit = a;
      else withdrawal = -a;
    } else {
      const d = parseBankAmount(row[iDep] ?? '');
      const w = parseBankAmount(row[iWd] ?? '');
      if ((d !== null && Number.isNaN(d)) || (w !== null && Number.isNaN(w))) {
        errors.push(`Row ${n}: an amount is not a number`);
        continue;
      }
      deposit = Math.abs(d ?? 0);
      withdrawal = Math.abs(w ?? 0);
      if (deposit > 0 === withdrawal > 0) {
        errors.push(
          `Row ${n}: needs either a deposit or a withdrawal, not ${deposit > 0 ? 'both' : 'neither'}`,
        );
        continue;
      }
    }
    const bal = iBal >= 0 ? parseBankAmount(row[iBal] ?? '') : null;
    lines.push({
      date,
      description: (row[iDesc] ?? '').slice(0, 500) || '(no description)',
      reference: iRef >= 0 && (row[iRef] ?? '') !== '' ? (row[iRef] ?? '').slice(0, 200) : null,
      deposit,
      withdrawal,
      balance: bal === null || Number.isNaN(bal) ? null : bal,
    });
  }
  if (lines.length === 0 && errors.length === 0) errors.push('No transactions found in the file.');
  // Opening balance: the balance before the first line, when the file has running balances.
  const first = lines[0];
  const last = lines[lines.length - 1];
  const openingBalance =
    first && first.balance !== null
      ? Math.round((first.balance - first.deposit + first.withdrawal) * 100) / 100
      : null;
  return { lines, errors, openingBalance, closingBalance: last?.balance ?? null };
}

/** The same bank line imported twice must be recognised; two identical lines in one file must both be kept. */
export function bankDedupeKeys(lines: ParsedBankLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = [
      l.date,
      l.description.toLowerCase(),
      l.reference ?? '',
      l.deposit.toFixed(2),
      l.withdrawal.toFixed(2),
    ].join('|');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}|${n}`;
  });
}

export interface MatchLine {
  id: string;
  date: string;
  deposit: number;
  withdrawal: number;
}
export interface MatchCandidate {
  id: string;
  date: string;
  debit: number;
  credit: number;
}

const DAY = 86_400_000;
export const dayGap = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY;

/** Candidates for one statement line: same amount and direction, within `window` days, nearest date first. */
export function candidatesFor(line: MatchLine, entries: MatchCandidate[], window = 5): MatchCandidate[] {
  const cents = (n: number) => Math.round(n * 100);
  return entries
    .filter(
      (e) =>
        cents(e.debit) === cents(line.deposit) &&
        cents(e.credit) === cents(line.withdrawal) &&
        dayGap(e.date, line.date) <= window,
    )
    .sort((a, b) => dayGap(a.date, line.date) - dayGap(b.date, line.date) || a.id.localeCompare(b.id));
}

/**
 * Automatic matching: a statement line is paired only when it has exactly one candidate and that candidate
 * is wanted by no other line. Anything ambiguous is left for a person.
 */
export function autoMatch(lines: MatchLine[], entries: MatchCandidate[], window = 3): Map<string, string> {
  const options = new Map(lines.map((l) => [l.id, candidatesFor(l, entries, window)]));
  const wantedBy = new Map<string, string[]>();
  for (const [lineId, c] of options)
    for (const e of c) wantedBy.set(e.id, [...(wantedBy.get(e.id) ?? []), lineId]);
  const result = new Map<string, string>();
  for (const [lineId, c] of options) {
    if (c.length === 1 && wantedBy.get(c[0]!.id)!.length === 1) result.set(lineId, c[0]!.id);
  }
  return result;
}
