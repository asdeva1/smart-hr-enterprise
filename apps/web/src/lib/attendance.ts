import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

export type DayStatus = 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'WEEKLY_OFF' | 'HOLIDAY' | 'ON_LEAVE';
export type CorrectionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED' | 'CANCELLED';

export interface DayView {
  date: string;
  status: DayStatus | null;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  corrected: boolean;
  open: boolean;
  shift: { code: string; name: string };
  /** Public holiday on this date, if any. */
  holiday: string | null;
}

export interface Today {
  employee: { id: string; name: string; employeeCode: string } | null;
  date: string;
  timeZone: string;
  holiday: string | null;
  leave: 'FULL' | 'FIRST_HALF' | 'SECOND_HALF' | null;
  shift: { code: string; name: string; startMinute: number; endMinute: number; graceMinutes: number };
  punches: { id: string; at: string; direction: 'IN' | 'OUT'; source: string; note: string | null }[];
  result: {
    status: DayStatus;
    firstIn: string | null;
    lastOut: string | null;
    workedMinutes: number;
    lateMinutes: number;
    openSince: string | null;
  };
  nextAction: 'IN' | 'OUT';
  canPunch: boolean;
}

export interface Shift {
  id: string;
  code: string;
  name: string;
  start: string;
  end: string;
  startMinute: number;
  endMinute: number;
  breakMinutes: number;
  graceMinutes: number;
  halfDayMinutes: number;
  fullDayMinutes: number;
  weeklyOffs: number[];
  isDefault: boolean;
  status: 'ACTIVE' | 'ARCHIVED';
  assigned?: number;
}

export interface Correction {
  id: string;
  date: string;
  inAt: string | null;
  outAt: string | null;
  reason: string;
  status: CorrectionStatus;
  requestedByUserId: string;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  timeZone: string;
  employee: { id: string; name: string; employeeCode: string };
  approvalRequest: { id: string; status: string } | null;
}

export interface TeamRow {
  employee: {
    id: string;
    name: string;
    employeeCode: string;
    department: string | null;
    designation: string | null;
    timeZone: string;
  };
  day: DayView;
}

export interface TeamDay {
  date: string;
  counts: {
    total: number;
    present: number;
    halfDay: number;
    absent: number;
    late: number;
    notIn: number;
    weeklyOff: number;
    holiday: number;
    onLeave: number;
  };
  rows: TeamRow[];
}

export interface Register {
  month: string;
  dates: string[];
  total: number;
  page: number;
  pageSize: number;
  rows: {
    employee: { id: string; name: string; employeeCode: string; department: string | null };
    days: { date: string; status: DayStatus | null; late: boolean }[];
    totals: {
      present: number;
      halfDay: number;
      absent: number;
      weeklyOff: number;
      holiday: number;
      onLeave: number;
      late: number;
      overtimeMinutes: number;
    };
  }[];
}

export const attendanceKeys = {
  today: ['attendance', 'today'] as const,
  myDays: (from: string, to: string) => ['attendance', 'my-days', from, to] as const,
  employeeDays: (id: string, from: string, to: string) =>
    ['attendance', 'employee-days', id, from, to] as const,
  team: (q: object) => ['attendance', 'team', q] as const,
  register: (q: object) => ['attendance', 'register', q] as const,
  shifts: ['attendance', 'shifts'] as const,
  corrections: (scope: string) => ['attendance', 'corrections', scope] as const,
  correction: (id: string) => ['attendance', 'correction', id] as const,
};

export const useToday = () =>
  useQuery({
    queryKey: attendanceKeys.today,
    queryFn: () => apiFetch<Today | { employee: null }>('/v1/attendance/me/today'),
  });

export const useMyDays = (from: string, to: string) =>
  useQuery({
    queryKey: attendanceKeys.myDays(from, to),
    queryFn: () =>
      apiFetch<{ employeeId: string; days: DayView[] }>(`/v1/attendance/me/days?from=${from}&to=${to}`),
    placeholderData: keepPreviousData,
  });

export const useShifts = () =>
  useQuery({
    queryKey: attendanceKeys.shifts,
    queryFn: () => apiFetch<{ shifts: Shift[]; fallback: Shift | null }>('/v1/attendance/shifts'),
  });

export const useCorrections = (scope: 'mine' | 'team') =>
  useQuery({
    queryKey: attendanceKeys.corrections(scope),
    queryFn: () => apiFetch<Correction[]>(`/v1/attendance/corrections?scope=${scope}`),
  });

export const DAY_LABEL: Record<DayStatus, string> = {
  PRESENT: 'Present',
  HALF_DAY: 'Half day',
  ABSENT: 'Absent',
  WEEKLY_OFF: 'Weekly off',
  HOLIDAY: 'Holiday',
  ON_LEAVE: 'On leave',
};
/** Single letters for the register grid; the legend spells them out. */
export const DAY_CODE: Record<DayStatus, string> = {
  PRESENT: 'P',
  HALF_DAY: 'H',
  ABSENT: 'A',
  WEEKLY_OFF: 'W',
  HOLIDAY: 'HO',
  ON_LEAVE: 'L',
};
export const DAY_TONE = {
  PRESENT: 'success',
  HALF_DAY: 'warning',
  ABSENT: 'danger',
  WEEKLY_OFF: 'neutral',
  HOLIDAY: 'neutral',
  ON_LEAVE: 'info',
} as const;

export const CORRECTION_LABEL: Record<CorrectionStatus, string> = {
  PENDING: 'Waiting for approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RETURNED: 'Sent back',
  CANCELLED: 'Withdrawn',
};
export const CORRECTION_TONE = {
  PENDING: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
  RETURNED: 'warning',
  CANCELLED: 'neutral',
} as const;

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A time in the employee's own time zone, so a manager elsewhere sees the same clock as the employee. */
export function clockTime(at: string | null | undefined, timeZone = 'Asia/Kolkata'): string {
  if (!at) return '—';
  return new Date(at).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  });
}

export function hoursAndMinutes(minutes: number): string {
  if (minutes <= 0) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
}

export function minutesToClock(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** First and last day of a YYYY-MM month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
