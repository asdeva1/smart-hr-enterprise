/**
 * Books arithmetic on posted journal lines, kept pure so it can be tested exactly. Amounts are handled in
 * paise (integers) to avoid floating-point drift, and returned in rupees.
 */

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

export interface AccountRef {
  id: string;
  code: string;
  name: string;
  type: AccountType;
}

export interface PostedLine {
  accountId: string;
  date: string;
  debit: number;
  credit: number;
}

export const toPaise = (rupees: number) => Math.round(rupees * 100);
export const toRupees = (paise: number) => paise / 100;

/** Assets and expenses grow with debits; liabilities, equity and income with credits. */
export const DEBIT_NORMAL = new Set<AccountType>(['ASSET', 'EXPENSE']);

export interface LineInput {
  accountId: string;
  debit: number;
  credit: number;
}

/** Problems with a journal's lines, or none. A journal balances, has at least two lines, and each line is one-sided. */
export function journalProblems(lines: LineInput[]): string[] {
  const problems: string[] = [];
  if (lines.length < 2) problems.push('A journal needs at least two lines');
  lines.forEach((l, i) => {
    const d = toPaise(l.debit);
    const c = toPaise(l.credit);
    if (d < 0 || c < 0) problems.push(`Line ${i + 1}: amounts can’t be negative`);
    else if (d > 0 === c > 0) problems.push(`Line ${i + 1}: enter either a debit or a credit`);
  });
  const debit = lines.reduce((s, l) => s + toPaise(l.debit), 0);
  const credit = lines.reduce((s, l) => s + toPaise(l.credit), 0);
  if (debit !== credit) {
    problems.push(
      `Debits (${toRupees(debit).toFixed(2)}) and credits (${toRupees(credit).toFixed(2)}) must be equal`,
    );
  }
  return problems;
}

export interface TrialBalanceRow extends AccountRef {
  debit: number;
  credit: number;
}

/** Each account's net balance shown on its natural side; the two columns total the same. */
export function trialBalance(
  accounts: AccountRef[],
  lines: PostedLine[],
): { rows: TrialBalanceRow[]; debit: number; credit: number } {
  const net = new Map<string, number>();
  for (const l of lines)
    net.set(l.accountId, (net.get(l.accountId) ?? 0) + toPaise(l.debit) - toPaise(l.credit));
  const rows = accounts
    .filter((a) => (net.get(a.id) ?? 0) !== 0)
    .map((a) => {
      const n = net.get(a.id)!;
      return { ...a, debit: n > 0 ? toRupees(n) : 0, credit: n < 0 ? toRupees(-n) : 0 };
    })
    .sort((x, y) => x.code.localeCompare(y.code));
  const debit = rows.reduce((s, r) => s + toPaise(r.debit), 0);
  const credit = rows.reduce((s, r) => s + toPaise(r.credit), 0);
  return { rows, debit: toRupees(debit), credit: toRupees(credit) };
}

/** An account's balance on its natural side (positive = normal). */
function natural(type: AccountType, debitMinusCredit: number) {
  return DEBIT_NORMAL.has(type) ? debitMinusCredit : -debitMinusCredit;
}

function balances(accounts: AccountRef[], lines: PostedLine[]) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const net = new Map<string, number>();
  for (const l of lines) {
    if (!byId.has(l.accountId)) continue;
    net.set(l.accountId, (net.get(l.accountId) ?? 0) + toPaise(l.debit) - toPaise(l.credit));
  }
  return accounts
    .map((a) => ({ ...a, paise: natural(a.type, net.get(a.id) ?? 0) }))
    .filter((a) => a.paise !== 0)
    .sort((x, y) => x.code.localeCompare(y.code));
}

const section = (rows: ReturnType<typeof balances>, type: AccountType) => {
  const items = rows.filter((r) => r.type === type);
  return {
    items: items.map(({ paise, ...a }) => ({ ...a, amount: toRupees(paise) })),
    total: toRupees(items.reduce((s, r) => s + r.paise, 0)),
  };
};

/** Income less expenses for lines in a period. */
export function profitAndLoss(accounts: AccountRef[], lines: PostedLine[]) {
  const rows = balances(accounts, lines);
  const income = section(rows, 'INCOME');
  const expenses = section(rows, 'EXPENSE');
  return { income, expenses, profit: toRupees(toPaise(income.total) - toPaise(expenses.total)) };
}

/**
 * Assets against liabilities and equity at a date, from every line up to it. Profit not yet closed into
 * retained earnings is shown as "current earnings" in equity, so the sheet always balances.
 */
export function balanceSheet(accounts: AccountRef[], lines: PostedLine[]) {
  const rows = balances(accounts, lines);
  const assets = section(rows, 'ASSET');
  const liabilities = section(rows, 'LIABILITY');
  const equity = section(rows, 'EQUITY');
  const earnings = toRupees(
    rows.filter((r) => r.type === 'INCOME').reduce((s, r) => s + r.paise, 0) -
      rows.filter((r) => r.type === 'EXPENSE').reduce((s, r) => s + r.paise, 0),
  );
  const totalEquity = toRupees(toPaise(equity.total) + toPaise(earnings));
  return {
    assets,
    liabilities,
    equity: { ...equity, currentEarnings: earnings, total: totalEquity },
    balanced: toPaise(assets.total) === toPaise(liabilities.total) + toPaise(totalEquity),
  };
}

/** An account's lines in date order with a running balance on its natural side. */
export function ledger(type: AccountType, opening: number, lines: (PostedLine & { id: string })[]) {
  let running = toPaise(opening);
  const rows = [...lines]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((l) => {
      running += natural(type, toPaise(l.debit) - toPaise(l.credit));
      return { ...l, balance: toRupees(running) };
    });
  return { opening, rows, closing: toRupees(running) };
}

/** Opening balance on the natural side from lines before a date. */
export function openingBalance(type: AccountType, lines: PostedLine[]) {
  return toRupees(
    natural(
      type,
      lines.reduce((s, l) => s + toPaise(l.debit) - toPaise(l.credit), 0),
    ),
  );
}
