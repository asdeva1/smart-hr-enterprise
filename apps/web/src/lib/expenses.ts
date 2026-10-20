import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

export type ClaimStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'PAID' | 'CANCELLED';

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Waiting for approval',
  APPROVED: 'Approved, to be paid',
  REJECTED: 'Rejected',
  PAID: 'Paid',
  CANCELLED: 'Withdrawn',
};
export const CLAIM_STATUS_TONE = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'info',
  APPROVED: 'warning',
  REJECTED: 'danger',
  PAID: 'success',
  CANCELLED: 'neutral',
} as const;

export interface ExpenseCategory {
  id: string;
  code: string;
  name: string;
  requiresReceipt: boolean;
  maxAmount: number | null;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface ClaimRow {
  id: string;
  number: string | null;
  title: string;
  status: ClaimStatus;
  total: number;
  currency: string;
  employee: { id: string; code: string; name: string };
  submittedAt: string | null;
  createdAt: string;
}

export interface Claim extends ClaimRow {
  decisionNote: string | null;
  decidedAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  approvalRequest: { id: string; status: string } | null;
  lines: {
    id: string;
    position: number;
    date: string;
    categoryId: string;
    category: string;
    description: string;
    amount: number;
    receiptNumber: string | null;
  }[];
}

export interface Vendor {
  id: string;
  code: string;
  name: string;
  gstin: string | null;
  pan: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  paymentTermsDays: number;
  notes: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
}

export const expenseKeys = {
  all: ['expenses'] as const,
  categories: ['expenses', 'categories'] as const,
  claims: (scope: string) => ['expenses', 'claims', scope] as const,
  claim: (id: string) => ['expenses', 'claim', id] as const,
  vendors: ['vendors'] as const,
};

export const useExpenseCategories = () =>
  useQuery({
    queryKey: expenseKeys.categories,
    queryFn: () => apiFetch<ExpenseCategory[]>('/v1/expenses/categories'),
  });

export function money(n: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(n);
}
