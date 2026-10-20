import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

export type RequestStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'ORDERED';
export type OrderStatus =
  'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'REJECTED' | 'CANCELLED';

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Waiting for approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Withdrawn',
  ORDERED: 'Ordered',
};
export const REQUEST_STATUS_TONE = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  ORDERED: 'success',
} as const;

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Waiting for approval',
  APPROVED: 'Approved, awaiting goods',
  PARTIALLY_RECEIVED: 'Partly received',
  RECEIVED: 'Received',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};
export const ORDER_STATUS_TONE = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'info',
  APPROVED: 'warning',
  PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
} as const;

export interface RequestRow {
  id: string;
  number: string | null;
  title: string;
  status: RequestStatus;
  estimatedTotal: number;
  currency: string;
  employee: { id: string; code: string; name: string };
  createdAt: string;
}

export interface PurchaseRequest extends RequestRow {
  mine: boolean;
  justification: string | null;
  decisionNote: string | null;
  approvalRequest: { id: string; status: string } | null;
  orders: { id: string; number: string | null; status: OrderStatus }[];
  lines: {
    id: string;
    position: number;
    description: string;
    quantity: number;
    estimatedUnitPrice: number;
    amount: number;
  }[];
}

export interface OrderRow {
  id: string;
  number: string | null;
  companyId: string;
  vendor: { id: string; code: string; name: string };
  status: OrderStatus;
  orderDate: string;
  total: number;
  currency: string;
}

export interface PurchaseOrder extends OrderRow {
  request: { id: string; number: string | null; title: string } | null;
  expectedDate: string | null;
  terms: string | null;
  subtotal: number;
  taxTotal: number;
  decisionNote: string | null;
  approvalRequest: { id: string; status: string } | null;
  lines: {
    id: string;
    position: number;
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    amount: number;
    receivedQuantity: number;
  }[];
  receipts: {
    id: string;
    number: string;
    receivedOn: string;
    note: string | null;
    lines: { orderLineId: string; quantity: number }[];
  }[];
}

export const procurementKeys = {
  all: ['procurement'] as const,
  requests: (scope: string) => ['procurement', 'requests', scope] as const,
  request: (id: string) => ['procurement', 'request', id] as const,
  orders: ['procurement', 'orders'] as const,
  order: (id: string) => ['procurement', 'order', id] as const,
};

export const useApprovedRequests = (enabled: boolean) =>
  useQuery({
    queryKey: [...procurementKeys.all, 'approved'],
    queryFn: () => apiFetch<RequestRow[]>('/v1/procurement/requests?scope=all&status=APPROVED'),
    enabled,
  });
