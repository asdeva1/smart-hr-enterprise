export interface BankAccountOption {
  id: string;
  code: string;
  name: string;
  isBank: boolean;
}

export interface BookItem {
  journalLineId: string;
  entryId: string;
  entryNumber: string | null;
  date: string;
  narration: string;
  source: string;
  debit: number;
  credit: number;
}

export type BankLineStatus = 'UNMATCHED' | 'MATCHED' | 'IGNORED';

export interface BankLine {
  id: string;
  statementId: string;
  date: string;
  description: string;
  reference: string | null;
  deposit: number;
  withdrawal: number;
  balance: number | null;
  status: BankLineStatus;
  note: string | null;
  matchedAt: string | null;
  match: BookItem | null;
  suggestions: BookItem[];
}

export interface BankStatementRow {
  id: string;
  fileName: string;
  periodFrom: string;
  periodTo: string;
  openingBalance: number | null;
  closingBalance: number | null;
  lineCount: number;
  importedAt: string;
}

export interface BankSummary {
  account: { id: string; code: string; name: string };
  asOf: string;
  bookBalance: number;
  statementBalance: number | null;
  statementDate: string | null;
  bankOnly: { count: number; deposits: number; withdrawals: number };
  bookOnly: { count: number; inTransit: number; uncleared: number };
  adjustedBank: number | null;
  adjustedBook: number;
  difference: number | null;
  reconciled: boolean;
  lines: Partial<Record<BankLineStatus, number>>;
}

export const bankKeys = {
  all: ['finance', 'bank'] as const,
};
