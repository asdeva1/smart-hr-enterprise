import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

export type EmployeeStatus = 'ACTIVE' | 'ON_NOTICE' | 'EXITED';
export type Gender = 'FEMALE' | 'MALE' | 'NON_BINARY' | 'UNDISCLOSED';

interface Coded {
  id: string;
  code: string;
  name: string;
}
interface Named {
  id: string;
  name: string;
}

export interface EmployeeListItem {
  id: string;
  employeeCode: string;
  name: string;
  firstName: string;
  lastName: string;
  workEmail: string | null;
  status: EmployeeStatus;
  dateOfJoining: string;
  lastWorkingDay: string | null;
  membershipId: string | null;
  company: Coded;
  branch: Coded | null;
  department: Coded | null;
  designation: Named | null;
  manager: { id: string; name: string } | null;
}

export interface Employee {
  id: string;
  employeeCode: string;
  name: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  workEmail: string | null;
  personalEmail: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  gender: Gender | null;
  companyId: string;
  branchId: string | null;
  departmentId: string | null;
  designationId: string | null;
  gradeId: string | null;
  employmentTypeId: string | null;
  costCentreId: string | null;
  managerId: string | null;
  dateOfJoining: string;
  probationEndDate: string | null;
  status: EmployeeStatus;
  noticeGivenOn: string | null;
  lastWorkingDay: string | null;
  exitReasonId: string | null;
  exitedOn: string | null;
  version: number;
  company: Coded;
  branch: Coded | null;
  department: Coded | null;
  designation: Named | null;
  grade: Named | null;
  employmentType: Named | null;
  costCentre: Named | null;
  exitReason: Named | null;
  manager: { id: string; employeeCode: string; name: string } | null;
  signIn: { status: 'ACTIVE' | 'SUSPENDED'; email: string } | null;
  directReports: number;
  can: {
    manage: boolean;
    lifecycle: boolean;
    viewSensitive: boolean;
    manageSensitive: boolean;
    invite: boolean;
  };
}

export interface EmployeeEvent {
  id: string;
  kind: 'JOINED' | 'TRANSFER' | 'PROMOTION' | 'MANAGER_CHANGE' | 'NOTICE' | 'NOTICE_WITHDRAWN' | 'EXIT';
  effectiveDate: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  note: string | null;
  recordedAt: string;
  recordedBy: string | null;
}

export interface SensitiveDetails {
  pan: string | null;
  aadhaar: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  bankName: string | null;
  uan: string | null;
  updatedAt?: string | null;
}

export interface EmergencyContact {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  email: string | null;
  isPrimary: boolean;
}

export interface OrgChartNode {
  id: string;
  employeeCode: string;
  name: string;
  managerId: string | null;
  status: EmployeeStatus;
  designation: string | null;
  department: string | null;
}

export interface EmployeeFilters {
  search: string;
  status: 'CURRENT' | EmployeeStatus | 'ALL';
  companyId: string;
  departmentId: string;
  page: number;
}

export const PAGE_SIZE = 50;

export const employeeKeys = {
  all: ['employees'] as const,
  list: (f: EmployeeFilters) => ['employees', 'list', f] as const,
  one: (id: string) => ['employees', 'one', id] as const,
  history: (id: string) => ['employees', 'history', id] as const,
  sensitive: (id: string) => ['employees', 'sensitive', id] as const,
  contacts: (id: string) => ['employees', 'contacts', id] as const,
  chart: ['employees', 'chart'] as const,
  changes: (id: string) => ['employees', 'changes', id] as const,
  change: (id: string) => ['employees', 'change', id] as const,
};

export type ChangeStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED' | 'CANCELLED';

/** An employment change waiting for approval (or decided). */
export interface EmploymentChange {
  id: string;
  employee: { id: string; name: string; employeeCode: string };
  action: string;
  actionLabel: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  effectiveDate: string;
  note: string | null;
  status: ChangeStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  requestedByUserId: string;
  approvalRequest: { id: string; status: string } | null;
}

export const useEmploymentChanges = (employeeId: string) =>
  useQuery({
    queryKey: employeeKeys.changes(employeeId),
    queryFn: () => apiFetch<EmploymentChange[]>(`/v1/employees/${employeeId}/changes`),
  });

export const useEmployees = (f: EmployeeFilters) =>
  useQuery({
    queryKey: employeeKeys.list(f),
    queryFn: () =>
      apiFetch<{ items: EmployeeListItem[]; total: number; page: number; pageSize: number }>(
        `/v1/employees?${new URLSearchParams({
          page: String(f.page),
          pageSize: String(PAGE_SIZE),
          status: f.status,
          ...(f.search ? { search: f.search } : {}),
          ...(f.companyId ? { companyId: f.companyId } : {}),
          ...(f.departmentId ? { departmentId: f.departmentId } : {}),
        }).toString()}`,
      ),
    placeholderData: keepPreviousData,
  });

export const useEmployee = (id: string) =>
  useQuery({ queryKey: employeeKeys.one(id), queryFn: () => apiFetch<Employee>(`/v1/employees/${id}`) });

export const useEmployeeHistory = (id: string) =>
  useQuery({
    queryKey: employeeKeys.history(id),
    queryFn: () => apiFetch<EmployeeEvent[]>(`/v1/employees/${id}/history`),
  });

export const useOrgChart = () =>
  useQuery({
    queryKey: employeeKeys.chart,
    queryFn: () => apiFetch<OrgChartNode[]>('/v1/employees/org-chart'),
  });

export const STATUS_LABEL: Record<EmployeeStatus, string> = {
  ACTIVE: 'Active',
  ON_NOTICE: 'On notice',
  EXITED: 'Left',
};
export const STATUS_TONE = { ACTIVE: 'success', ON_NOTICE: 'warning', EXITED: 'neutral' } as const;

export const GENDER_LABEL: Record<Gender, string> = {
  FEMALE: 'Female',
  MALE: 'Male',
  NON_BINARY: 'Non-binary',
  UNDISCLOSED: 'Prefer not to say',
};

export const EVENT_LABEL: Record<EmployeeEvent['kind'], string> = {
  JOINED: 'Joined',
  TRANSFER: 'Transferred',
  PROMOTION: 'Promoted',
  MANAGER_CHANGE: 'Manager changed',
  NOTICE: 'Gave notice',
  NOTICE_WITHDRAWN: 'Notice withdrawn',
  EXIT: 'Left',
};

export const CHANGE_LABEL: Record<string, string> = {
  company: 'Company',
  branch: 'Branch',
  department: 'Department',
  designation: 'Designation',
  grade: 'Grade',
  manager: 'Manager',
  costCentre: 'Cost centre',
  status: 'Status',
  lastWorkingDay: 'Last working day',
  exitReason: 'Reason',
  signIn: 'Sign-in',
};

/** Shows a date stored as YYYY-MM-DD without shifting it through the browser's time zone. */
export function formatDay(value: string | null | undefined): string {
  if (!value) return '—';
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function todayIso(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** Template for the CSV import, with one example row people can overwrite. */
export const IMPORT_TEMPLATE = [
  'employee_code,first_name,last_name,work_email,phone,date_of_joining,date_of_birth,gender,company_code,branch_code,department_code,designation_code,grade_code,employment_type_code,cost_centre_code,manager_code',
  ',Meera,Iyer,meera.iyer@example.com,+91 98765 43210,2026-04-01,1992-08-14,Female,ACME-IN,HYD,ICU,,,FT,,',
].join('\n');
