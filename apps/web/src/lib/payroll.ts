import { useQuery } from '@tanstack/react-query';
import { ApiError, ApiUnreachableError, apiBaseUrl, apiFetch } from './api';

export type RunStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PAID' | 'CANCELLED';

export interface PayComponent {
  id: string;
  code: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION';
  taxable: boolean;
  pfWage: boolean;
  esiWage: boolean;
  prorate: boolean;
  sortOrder: number;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface Line {
  code: string;
  name: string;
  amount: number;
}

export interface Adjustment {
  name: string;
  kind: 'EARNING' | 'DEDUCTION';
  amount: number;
  taxable: boolean;
}

export interface Payslip {
  id: string;
  runId: string;
  employeeId: string;
  employee?: { id: string; name: string; employeeCode: string };
  employedDays: number;
  lopDays: number;
  lopOverride: number | null;
  paidDays: number;
  earnings: Line[];
  deductions: Line[];
  employer: Line[];
  adjustments: Adjustment[];
  gross: number;
  totalDeductions: number;
  net: number;
  employerCost: number;
  pfWages: number;
  esiWages: number;
  esiCovered: boolean;
  tds: {
    projectedAnnualTaxable: number;
    annualTax: number;
    deductedBefore: number;
    monthsLeft: number;
  } | null;
  warnings: string[];
  period?: string;
}

export interface PayrollRun {
  id: string;
  company: { id: string; name: string; baseCurrency: string };
  year: number;
  month: number;
  period: string;
  status: RunStatus;
  employeeCount: number;
  gross: number;
  deductions: number;
  net: number;
  employerCost: number;
  approvalRequestId: string | null;
  calculatedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  payslips: (Payslip & { employee: { id: string; name: string; employeeCode: string } })[];
  can: {
    manage: boolean;
    edit: boolean;
    submit: boolean;
    markPaid: boolean;
    cancel: boolean;
    export: boolean;
  };
}

export interface EmployeePay {
  employee: { id: string; name: string; employeeCode: string; dateOfJoining: string };
  profile: { pfEnabled: boolean; pfOnFullWages: boolean; esiEnabled: boolean; ptState: string | null };
  salaries: {
    id: string;
    effectiveFrom: string;
    annualCtc: number;
    lines: { componentId: string; code: string; name: string; monthly: number }[];
    monthlyGross: number;
    note: string | null;
    createdAt: string;
  }[];
  can: { manage: boolean };
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Waiting for approval',
  APPROVED: 'Approved',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
};
export const RUN_STATUS_TONE = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'info',
  APPROVED: 'success',
  PAID: 'success',
  CANCELLED: 'neutral',
} as const;

export const STATES: Record<string, string> = {
  AP: 'Andhra Pradesh',
  AS: 'Assam',
  BR: 'Bihar',
  CG: 'Chhattisgarh',
  DL: 'Delhi',
  GA: 'Goa',
  GJ: 'Gujarat',
  HR: 'Haryana',
  JH: 'Jharkhand',
  KA: 'Karnataka',
  KL: 'Kerala',
  MP: 'Madhya Pradesh',
  MH: 'Maharashtra',
  OR: 'Odisha',
  PB: 'Punjab',
  RJ: 'Rajasthan',
  TN: 'Tamil Nadu',
  TG: 'Telangana',
  UP: 'Uttar Pradesh',
  UK: 'Uttarakhand',
  WB: 'West Bengal',
};

export const payrollKeys = {
  all: ['payroll'] as const,
  components: ['payroll', 'components'] as const,
  runs: ['payroll', 'runs'] as const,
  run: (id: string) => ['payroll', 'run', id] as const,
  employee: (id: string) => ['payroll', 'employee', id] as const,
  mine: ['payroll', 'mine'] as const,
  settings: (companyId: string) => ['payroll', 'settings', companyId] as const,
  pt: ['payroll', 'pt'] as const,
};

export const usePayComponents = (enabled = true) =>
  useQuery({
    queryKey: payrollKeys.components,
    queryFn: () => apiFetch<PayComponent[]>('/v1/payroll/components'),
    enabled,
  });
export const usePayrollRuns = () =>
  useQuery({ queryKey: payrollKeys.runs, queryFn: () => apiFetch<PayrollRun[]>('/v1/payroll/runs') });
export const usePayrollRun = (id: string) =>
  useQuery({ queryKey: payrollKeys.run(id), queryFn: () => apiFetch<PayrollRun>(`/v1/payroll/runs/${id}`) });
export const useEmployeePay = (id: string) =>
  useQuery({
    queryKey: payrollKeys.employee(id),
    queryFn: () => apiFetch<EmployeePay>(`/v1/payroll/employees/${id}`),
  });
export const useMyPayslips = () =>
  useQuery({
    queryKey: payrollKeys.mine,
    queryFn: () =>
      apiFetch<{
        employee: { id: string } | null;
        payslips: { id: string; year: number; month: number; period: string; gross: number; net: number }[];
      }>('/v1/payroll/me/payslips'),
  });

export function rupees(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Downloads a file from the API with fetch, so a refusal (say, a password check needed) comes back as an
 * ApiError instead of a page of JSON. Saves it under the name the API gives.
 */
export async function downloadFile(path: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, { credentials: 'include', cache: 'no-store' });
  } catch {
    throw new ApiUnreachableError();
  }
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as {
      code?: string;
      detail?: string;
      title?: string;
    };
    throw new ApiError(
      response.status,
      problem.code ?? 'ERROR',
      problem.detail ?? problem.title ?? 'The file could not be made.',
    );
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const name = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];
  const fallback = /filename="([^"]+)"/.exec(disposition)?.[1];
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name ? decodeURIComponent(name) : (fallback ?? 'download');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
