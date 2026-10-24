import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

export interface AttendancePolicy {
  configured: boolean;
  overtimeEnabled: boolean;
  overtimeThresholdMinutes: number;
  overtimeRoundMinutes: 1 | 5 | 10 | 15 | 30 | 60;
  overtimeDailyCapMinutes: number | null;
  overtimeOffDayCounts: boolean;
  overtimeNeedsApproval: boolean;
  maxCorrectionsPerMonth: number | null;
  maxCorrectionBackdateDays: number | null;
  geofenceMode: 'OFF' | 'WARN' | 'ENFORCE';
}

export interface WorkLocationRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface RosterView {
  dates: string[];
  shifts: { id: string; code: string; name: string; startMinute: number; endMinute: number }[];
  employees: {
    id: string;
    employeeCode: string;
    name: string;
    days: { date: string; rostered: boolean; shiftId: string | null; shiftCode: string | null }[];
  }[];
}

export interface OvertimeRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  date: string;
  workedMinutes: number;
  overtimeMinutes: number;
  decision: 'PENDING' | 'APPROVED' | 'REJECTED' | 'AUTO';
  approvedMinutes: number;
  note: string | null;
}

export interface OvertimeView {
  needsApproval: boolean;
  rows: OvertimeRow[];
  totals: { pendingMinutes: number; approvedMinutes: number };
}

export const advancedKeys = {
  policy: ['attendance', 'policy'] as const,
  locations: ['attendance', 'locations'] as const,
  roster: (from: string, to: string, search: string) => ['attendance', 'roster', from, to, search] as const,
  overtime: (from: string, to: string, status: string) =>
    ['attendance', 'overtime', from, to, status] as const,
};

export const usePolicy = () =>
  useQuery({
    queryKey: advancedKeys.policy,
    queryFn: () => apiFetch<AttendancePolicy>('/v1/attendance/policy'),
  });

export const useLocations = () =>
  useQuery({
    queryKey: advancedKeys.locations,
    queryFn: () => apiFetch<WorkLocationRow[]>('/v1/attendance/locations'),
  });

/** The Monday on or before a date (YYYY-MM-DD). */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}

export function shiftDate(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export function monthRange(date: string): { from: string; to: string } {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-${last}` };
}
