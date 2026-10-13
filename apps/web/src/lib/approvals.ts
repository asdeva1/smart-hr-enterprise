'use client';

import { useQuery } from '@tanstack/react-query';
import type { ApprovalPolicyDefinition } from '@smart-hr/validation';
import { apiFetch } from './api';
import type { ScopeType } from './admin';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED' | 'CANCELLED';
export type TaskStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED' | 'SKIPPED' | 'CANCELLED';

export interface RequestSummary {
  id: string;
  subjectType: string;
  subjectLabel: string;
  subjectId: string;
  title: string;
  amount: string | null;
  currency: string | null;
  status: ApprovalStatus;
  currentStage: number;
  round: number;
  createdAt: string;
  decidedAt: string | null;
  scopeType: ScopeType;
  scopeId: string;
  requestedBy: { id: string; user: { displayName: string } };
}

export interface InboxTask {
  id: string;
  stage: number;
  stageName: string;
  dueAt: string | null;
  createdAt: string;
  delegatedFromMembershipId: string | null;
  request: RequestSummary;
}

export interface RequestDetail extends RequestSummary {
  policy: { id: string; name: string; version: number };
  stages: { name: string; mode: 'ANY' | 'ALL'; minAmount: string | null }[];
  tasks: {
    id: string;
    round: number;
    stage: number;
    stageName: string;
    status: TaskStatus;
    comment: string | null;
    actedAt: string | null;
    dueAt: string | null;
    assignee: string;
    delegated: boolean;
    isMine: boolean;
  }[];
  isMine: boolean;
}

export interface PolicySummary {
  subjectType: string;
  label: string;
  module: string;
  hasAmount: boolean;
  active: {
    id: string;
    name: string;
    version: number;
    definition: ApprovalPolicyDefinition;
    createdAt: string;
  } | null;
  versions: number;
}

export interface Delegation {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  direction: 'given' | 'received';
  from: string;
  to: string;
}

export interface Colleague {
  membershipId: string;
  displayName: string;
}

export interface Notification {
  id: string;
  category: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationPreference {
  category: string;
  label: string;
  emailEnabled: boolean;
}

export const approvalKeys = {
  all: ['approvals'] as const,
  inbox: ['approvals', 'inbox'] as const,
  requests: (view: 'mine' | 'all', status: string) => ['approvals', 'requests', view, status] as const,
  request: (id: string) => ['approvals', 'request', id] as const,
  policies: ['approvals', 'policies'] as const,
  delegations: ['approvals', 'delegations'] as const,
  colleagues: (search: string) => ['approvals', 'colleagues', search] as const,
  notifications: ['notifications'] as const,
  preferences: ['notifications', 'preferences'] as const,
};

export const useInbox = () =>
  useQuery({ queryKey: approvalKeys.inbox, queryFn: () => apiFetch<InboxTask[]>('/v1/approvals/inbox') });

export const useRequests = (view: 'mine' | 'all', status: string, enabled = true) =>
  useQuery({
    queryKey: approvalKeys.requests(view, status),
    queryFn: () =>
      apiFetch<RequestSummary[]>(
        `/v1/approvals/requests?${new URLSearchParams({ view, ...(status ? { status } : {}) }).toString()}`,
      ),
    enabled,
  });

export const useNotifications = () =>
  useQuery({
    queryKey: approvalKeys.notifications,
    queryFn: () => apiFetch<{ items: Notification[]; unread: number }>('/v1/notifications'),
    // New approvals arrive from other people; a gentle poll keeps the bell current.
    refetchInterval: 60_000,
  });

export const STATUS_TONE: Record<
  ApprovalStatus | TaskStatus,
  'success' | 'warning' | 'danger' | 'info' | 'neutral'
> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  RETURNED: 'info',
  CANCELLED: 'neutral',
  SKIPPED: 'neutral',
};

export const STATUS_LABEL: Record<ApprovalStatus | TaskStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RETURNED: 'Sent back',
  CANCELLED: 'Withdrawn',
  SKIPPED: 'Not needed',
};

/**
 * Exact amounts as the API sends them, grouped Indian-style without going through floating point.
 * Anything that isn't a plain decimal (e.g. half-typed input) is shown as typed rather than throwing.
 */
export function formatAmount(amount: string | null, currency: string | null): string {
  if (amount === null) return '—';
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!match) return amount;
  const grouped = BigInt(match[1]!).toLocaleString('en-IN');
  return `${currency ? `${currency} ` : ''}${grouped}.${(match[2] ?? '').padEnd(2, '0').slice(0, 2)}`;
}
