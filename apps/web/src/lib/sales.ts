import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

export type SalesDocType = 'INVOICE' | 'QUOTATION' | 'PROFORMA' | 'CHALLAN' | 'CREDIT_NOTE';
export type SalesDocStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';
export type PaymentMode = 'BANK' | 'CASH' | 'UPI' | 'CARD' | 'CHEQUE';

export const DOC_TYPE_LABEL: Record<SalesDocType, string> = {
  INVOICE: 'Invoice',
  QUOTATION: 'Quotation',
  PROFORMA: 'Proforma invoice',
  CHALLAN: 'Delivery challan',
  CREDIT_NOTE: 'Credit note',
};
export const DOC_TYPE_PLURAL: Record<SalesDocType, string> = {
  INVOICE: 'Invoices',
  QUOTATION: 'Quotations',
  PROFORMA: 'Proforma invoices',
  CHALLAN: 'Delivery challans',
  CREDIT_NOTE: 'Credit notes',
};
export const DOC_TITLE: Record<SalesDocType, string> = {
  INVOICE: 'TAX INVOICE',
  QUOTATION: 'QUOTATION',
  PROFORMA: 'PROFORMA INVOICE',
  CHALLAN: 'DELIVERY CHALLAN',
  CREDIT_NOTE: 'CREDIT NOTE',
};
export const STATUS_LABEL: Record<SalesDocStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Sent',
  PARTIALLY_PAID: 'Part paid',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
};
export const STATUS_TONE = {
  DRAFT: 'neutral',
  ISSUED: 'info',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  CANCELLED: 'neutral',
} as const;
export const MODE_LABEL: Record<PaymentMode, string> = {
  BANK: 'Bank transfer',
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Card',
  CHEQUE: 'Cheque',
};
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28] as const;

export interface Customer {
  id: string;
  code: string;
  name: string;
  gstin: string | null;
  pan: string | null;
  stateCode: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  paymentTermsDays: number;
  notes: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface Template {
  id: string;
  name: string;
  layout: 'CLASSIC' | 'MODERN' | 'MINIMAL' | 'COMPACT_GST';
  accent: string;
  showHsn: boolean;
  showGstSplit: boolean;
  showBank: boolean;
  showUpi: boolean;
  showSignatory: boolean;
  showPo: boolean;
  defaultTerms: string | null;
  defaultNote: string | null;
  isDefault: boolean;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface Seller {
  gstin: string | null;
  pan: string | null;
  stateCode: string | null;
  address: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankIfsc: string | null;
  upiId: string | null;
  signatory: string | null;
}

export interface SalesLine {
  id?: string;
  description: string;
  hsn: string | null;
  quantity: number;
  unit: string | null;
  rate: number;
  discountPct: number;
  gstRate: number;
  amount?: number;
}

export interface SalesDocument {
  id: string;
  companyId: string;
  company: { id: string; name: string; legalName: string | null } | null;
  seller: Seller | null;
  type: SalesDocType;
  number: string | null;
  status: SalesDocStatus;
  date: string;
  dueDate: string | null;
  poNumber: string | null;
  placeOfSupply: string | null;
  note: string | null;
  terms: string | null;
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  settled: number;
  outstanding: number;
  amountInWords: string;
  relatedId: string | null;
  journalEntryId: string | null;
  customer: {
    id: string;
    name: string;
    gstin: string | null;
    stateCode: string | null;
    billingAddress: string | null;
    shippingAddress: string | null;
    email: string | null;
  };
  template: Omit<Template, 'defaultTerms' | 'defaultNote' | 'isDefault' | 'status'> | null;
  lines: SalesLine[];
}

export interface SalesRow {
  id: string;
  number: string | null;
  type: SalesDocType;
  status: SalesDocStatus;
  date: string;
  dueDate: string | null;
  overdue: boolean;
  customer: { id: string; name: string };
  template: string | null;
  total: number;
  outstanding: number;
}

export const salesKeys = {
  all: ['sales'] as const,
  customers: ['sales', 'customers'] as const,
  templates: ['sales', 'templates'] as const,
  documents: (companyId: string, type: string, status: string, q: string) =>
    ['sales', 'documents', companyId, type, status, q] as const,
  document: (id: string) => ['sales', 'document', id] as const,
  settings: (companyId: string) => ['sales', 'settings', companyId] as const,
  summary: (companyId: string) => ['sales', 'summary', companyId] as const,
};

export const useCustomers = () =>
  useQuery({
    queryKey: salesKeys.customers,
    queryFn: () => apiFetch<Customer[]>('/v1/finance/sales/customers'),
  });

export const useTemplates = () =>
  useQuery({
    queryKey: salesKeys.templates,
    queryFn: () => apiFetch<Template[]>('/v1/finance/sales/templates'),
  });

/** Indian GST states and union territories by GST code. */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
};
