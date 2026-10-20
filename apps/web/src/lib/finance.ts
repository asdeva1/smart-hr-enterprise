import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useCompanies } from './admin';
import { apiFetch } from './api';

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
export type JournalStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'POSTED' | 'CANCELLED';

export interface LedgerAccount {
  id: string;
  companyId: string;
  code: string;
  name: string;
  type: AccountType;
  systemKey: string | null;
  description: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface Journal {
  id: string;
  companyId: string;
  number: string | null;
  date: string;
  narration: string;
  source: 'MANUAL' | 'REVERSAL' | 'PAYROLL' | 'PAYROLL_PAYMENT';
  sourceId: string | null;
  status: JournalStatus;
  total: number;
  approvalRequestId: string | null;
  reversesId: string | null;
  reversedById: string | null;
  postedAt: string | null;
  createdAt: string;
  lines: {
    id: string;
    account: { id: string; code: string; name: string; type: AccountType };
    debit: number;
    credit: number;
    narration: string | null;
  }[];
  can?: { edit: boolean; submit: boolean; cancel: boolean; reverse: boolean };
}

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  ASSET: 'Asset',
  LIABILITY: 'Liability',
  EQUITY: 'Equity',
  INCOME: 'Income',
  EXPENSE: 'Expense',
};
export const JOURNAL_STATUS_LABEL: Record<JournalStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Waiting for approval',
  POSTED: 'Posted',
  CANCELLED: 'Cancelled',
};
export const JOURNAL_STATUS_TONE = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'info',
  POSTED: 'success',
  CANCELLED: 'neutral',
} as const;
export const SOURCE_LABEL = {
  MANUAL: 'Journal',
  REVERSAL: 'Reversal',
  PAYROLL: 'Payroll',
  PAYROLL_PAYMENT: 'Salary payment',
} as const;

export const financeKeys = {
  all: ['finance'] as const,
  accounts: (companyId: string) => ['finance', 'accounts', companyId] as const,
  journals: (companyId: string, status: string) => ['finance', 'journals', companyId, status] as const,
  journal: (id: string) => ['finance', 'journal', id] as const,
  report: (kind: string, companyId: string, from: string, to: string) =>
    ['finance', 'report', kind, companyId, from, to] as const,
  ledger: (accountId: string, from: string, to: string) =>
    ['finance', 'ledger', accountId, from, to] as const,
  books: (companyId: string) => ['finance', 'books', companyId] as const,
};

export const useAccounts = (companyId: string) =>
  useQuery({
    queryKey: financeKeys.accounts(companyId),
    queryFn: () => apiFetch<LedgerAccount[]>(`/v1/finance/accounts?companyId=${companyId}`),
    enabled: !!companyId,
  });

/** The company whose books are open, remembered in this browser. */
export function useBooksCompany(): [string, (id: string) => void] {
  const companies = useCompanies();
  // Read once on first render; the company list isn't loaded during server rendering, so nothing differs.
  const [chosen, setChosen] = useState(() => {
    try {
      return typeof window === 'undefined' ? '' : (localStorage.getItem('finance.company') ?? '');
    } catch {
      return '';
    }
  });
  const valid = companies.data?.some((c) => c.id === chosen) ? chosen : (companies.data?.[0]?.id ?? '');
  return [
    valid,
    (id: string) => {
      setChosen(id);
      try {
        localStorage.setItem('finance.company', id);
      } catch {
        /* storage unavailable */
      }
    },
  ];
}

export function inr(n: number): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

/** Start of the financial year (1 April) for a date. */
export function fyStart(date: string): string {
  const y = Number(date.slice(0, 4));
  return `${Number(date.slice(5, 7)) >= 4 ? y : y - 1}-04-01`;
}
