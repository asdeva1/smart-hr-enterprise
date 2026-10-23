export type AlertTone = 'danger' | 'warning' | 'info';
export type AlertArea = 'HR' | 'FINANCE' | 'PROJECTS';

export interface OverviewAlert {
  id: string;
  area: AlertArea;
  tone: AlertTone;
  title: string;
  detail: string;
  count: number;
  link: string;
}

export interface MonthValue {
  label: string;
  value: number;
}

export interface Overview {
  generatedAt: string;
  hr: {
    headcount: number;
    onNotice: number;
    joinedLast30: number;
    joinedByMonth: MonthValue[];
    pendingLeave: number | null;
    onLeaveToday: number | null;
    openRoles: number | null;
  } | null;
  finance: {
    receivables: number;
    overdueReceivables: number;
    overdueInvoices: number;
    payables: number;
    overduePayables: number;
    billsDueThisWeek: number;
    unmatchedBankLines: number;
    invoicedByMonth: MonthValue[];
  } | null;
  projects: {
    active: number;
    overBudget: number;
    timeToApproveHours: number;
    busiest: {
      id: string;
      code: string;
      name: string;
      budgetHours: number | null;
      loggedHours: number;
      percent: number | null;
    }[];
  } | null;
  alerts: OverviewAlert[];
}

export const overviewKeys = { overview: ['me', 'overview'] as const };

/** Rupees in the Indian digit grouping, shortened to lakh and crore once the number is large. */
export function inr(value: number, short = false): string {
  if (short) {
    const abs = Math.abs(value);
    if (abs >= 1e7) return `₹${(value / 1e7).toFixed(abs >= 1e8 ? 1 : 2)} Cr`;
    if (abs >= 1e5) return `₹${(value / 1e5).toFixed(abs >= 1e6 ? 1 : 2)} L`;
  }
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}
