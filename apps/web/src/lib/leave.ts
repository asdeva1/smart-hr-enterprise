import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED' | 'CANCELLED';
export type Accrual = 'YEARLY' | 'MONTHLY' | 'NONE';
export type HalfDay = 'FIRST_HALF' | 'SECOND_HALF';

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  paid: boolean;
  accrual: Accrual;
  quotaDays: number;
  carryForwardMaxDays: number;
  allowHalfDay: boolean;
  includeNonWorkingDays: boolean;
  minNoticeDays: number;
  maxDaysPerRequest: number | null;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface Balance {
  leaveType: { id: string; code: string; name: string; paid: boolean; accrual: Accrual };
  year: number;
  credited: number;
  carriedForward: number;
  adjusted: number;
  taken: number;
  lapsed: number;
  balance: number;
  pending: number;
  available: number;
}

export interface LeaveRequest {
  id: string;
  employee: { id: string; name: string; employeeCode: string };
  leaveType: { id: string; code: string; name: string; paid: boolean };
  from: string;
  to: string;
  halfDay: HalfDay | null;
  days: number;
  reason: string;
  status: LeaveStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  requestedByUserId: string;
  approvalRequest: { id: string; status: string; currentStage: number } | null;
  canCancel: boolean;
}

export interface LedgerEntry {
  id: string;
  leaveType: string;
  kind: 'GRANT' | 'ACCRUAL' | 'CARRY_FORWARD' | 'LAPSE' | 'ADJUSTMENT' | 'TAKEN' | 'REVERSAL';
  days: number;
  note: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  optional: boolean;
}

export interface HolidayCalendar {
  id: string;
  name: string;
  status: 'ACTIVE' | 'ARCHIVED';
  place: { type: 'TENANT' } | { type: 'COMPANY'; id: string } | { type: 'BRANCH'; id: string };
  placeName: string;
  holidays: number;
  canEdit: boolean;
}

export const leaveKeys = {
  types: ['leave', 'types'] as const,
  myBalances: (year: number) => ['leave', 'my-balances', year] as const,
  requests: (q: object) => ['leave', 'requests', q] as const,
  request: (id: string) => ['leave', 'request', id] as const,
  balances: (q: object) => ['leave', 'balances', q] as const,
  employee: (id: string, year: number) => ['leave', 'employee', id, year] as const,
  calendar: (from: string, to: string) => ['leave', 'calendar', from, to] as const,
  holidaysMine: (year: number) => ['holidays', 'mine', year] as const,
  calendars: ['holidays', 'calendars'] as const,
  holidays: (calendarId: string, year: number) => ['holidays', calendarId, year] as const,
};

export const useLeaveTypes = () =>
  useQuery({ queryKey: leaveKeys.types, queryFn: () => apiFetch<LeaveType[]>('/v1/leave/types') });

export const useMyBalances = (year: number) =>
  useQuery({
    queryKey: leaveKeys.myBalances(year),
    queryFn: () =>
      apiFetch<{ employee: { id: string; name: string } | null; balances: Balance[] }>(
        `/v1/leave/me/balances?year=${year}`,
      ),
  });

export const useLeaveRequests = (scope: 'mine' | 'team', status?: LeaveStatus) =>
  useQuery({
    queryKey: leaveKeys.requests({ scope, status }),
    queryFn: () =>
      apiFetch<LeaveRequest[]>(`/v1/leave/requests?scope=${scope}${status ? `&status=${status}` : ''}`),
  });

export const useMyHolidays = (year: number) =>
  useQuery({
    queryKey: leaveKeys.holidaysMine(year),
    queryFn: () =>
      apiFetch<{ calendar: { id: string; name: string } | null; holidays: Holiday[] }>(
        `/v1/holidays/mine?year=${year}`,
      ),
  });

export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  PENDING: 'Waiting for approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RETURNED: 'Sent back',
  CANCELLED: 'Cancelled',
};
export const LEAVE_STATUS_TONE = {
  PENDING: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
  RETURNED: 'warning',
  CANCELLED: 'neutral',
} as const;

export const ACCRUAL_LABEL: Record<Accrual, string> = {
  YEARLY: 'Credited each January',
  MONTHLY: 'Credited monthly',
  NONE: 'No balance kept',
};

export const LEDGER_LABEL: Record<LedgerEntry['kind'], string> = {
  GRANT: 'Yearly grant',
  ACCRUAL: 'Monthly accrual',
  CARRY_FORWARD: 'Carried forward',
  LAPSE: 'Lapsed',
  ADJUSTMENT: 'Adjustment',
  TAKEN: 'Taken',
  REVERSAL: 'Returned',
};

/** "1 day", "2.5 days". */
export function days(n: number): string {
  return `${n} day${n === 1 ? '' : 's'}`;
}

/** "14 Oct 2026", "14–16 Oct 2026", or "14 Oct 2026 (afternoon)". */
export function leaveDates(from: string, to: string, halfDay: HalfDay | null): string {
  const fmt = (v: string, opts: Intl.DateTimeFormatOptions) => {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(Date.UTC(y!, m! - 1, d)).toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' });
  };
  const full = { day: 'numeric', month: 'short', year: 'numeric' } as const;
  if (from === to) {
    const half = halfDay ? ` (${halfDay === 'FIRST_HALF' ? 'morning' : 'afternoon'})` : '';
    return `${fmt(from, full)}${half}`;
  }
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return sameMonth
    ? `${fmt(from, { day: 'numeric' })}–${fmt(to, full)}`
    : `${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(to, full)}`;
}
