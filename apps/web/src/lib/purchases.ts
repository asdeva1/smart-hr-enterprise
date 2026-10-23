import type { PaymentMode } from './sales';

export type BillType = 'BILL' | 'DEBIT_NOTE';
export type BillStatus = 'DRAFT' | 'POSTED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';

export const BILL_STATUS_LABEL: Record<BillStatus, string> = {
  DRAFT: 'Draft',
  POSTED: 'Unpaid',
  PARTIALLY_PAID: 'Part paid',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
};
export const BILL_STATUS_TONE = {
  DRAFT: 'neutral',
  POSTED: 'info',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  CANCELLED: 'neutral',
} as const;
export const BILL_TYPE_LABEL: Record<BillType, string> = { BILL: 'Bill', DEBIT_NOTE: 'Debit note' };
export const TDS_RATES = [0, 1, 2, 5, 10, 20] as const;

export interface BillRow {
  id: string;
  number: string | null;
  vendorBillNo: string | null;
  type: BillType;
  status: BillStatus;
  date: string;
  dueDate: string | null;
  overdue: boolean;
  vendor: { id: string; name: string };
  total: number;
  tdsAmount: number;
  outstanding: number;
}

export interface BillLine {
  id?: string;
  description: string;
  hsn: string | null;
  quantity: number;
  rate: number;
  gstRate: number;
  amount: number;
  accountId: string;
  account: { id: string; code: string; name: string } | null;
}

export interface Bill {
  id: string;
  companyId: string;
  type: BillType;
  number: string | null;
  vendorBillNo: string | null;
  status: BillStatus;
  date: string;
  dueDate: string | null;
  placeOfSupply: string | null;
  note: string | null;
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  tdsRate: number;
  tdsAmount: number;
  payable: number;
  settled: number;
  outstanding: number;
  relatedId: string | null;
  journalEntryId: string | null;
  vendor: { id: string; name: string; code: string; gstin: string | null; address: string | null };
  lines: BillLine[];
}

export interface VendorPaymentRow {
  id: string;
  number: string;
  date: string;
  vendor: { id: string; name: string };
  amount: number;
  mode: PaymentMode;
  reference: string | null;
  allocations: { billId: string; number: string | null; amount: number }[];
  unallocated: number;
}

export const purchaseKeys = {
  all: ['purchases'] as const,
  bills: (companyId: string, type: string, status: string, q: string) =>
    ['purchases', 'bills', companyId, type, status, q] as const,
  bill: (id: string) => ['purchases', 'bill', id] as const,
  summary: (companyId: string) => ['purchases', 'summary', companyId] as const,
};
