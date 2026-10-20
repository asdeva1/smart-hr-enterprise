export type ProjectStatus = 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
};

export interface ProjectRow {
  id: string;
  companyId: string;
  code: string;
  name: string;
  clientName: string | null;
  status: ProjectStatus;
  billable: boolean;
  hourlyRate: number;
  budgetHours: number | null;
  startDate: string | null;
  endDate: string | null;
  managerId: string | null;
  notes: string | null;
  loggedHours: number;
  approvedHours: number;
  overBudget: boolean;
}

export interface ProjectDetail extends ProjectRow {
  manager: { id: string; name: string } | null;
  members: { employeeId: string; code: string; name: string; costRate: number | null; hours: number }[];
  money: { revenue: number; cost: number; profit: number } | null;
}

export interface MyProject {
  id: string;
  code: string;
  name: string;
  clientName: string | null;
  billable: boolean;
}

export interface TimeEntry {
  id: string;
  projectId: string;
  project: { code: string; name: string } | null;
  employeeId: string;
  employeeName: string | null;
  workDate: string;
  hours: number;
  billable: boolean;
  note: string | null;
  status: 'OPEN' | 'APPROVED';
}

export const projectKeys = {
  all: ['projects'] as const,
  list: ['projects', 'list'] as const,
  mine: ['projects', 'mine'] as const,
  detail: (id: string) => ['projects', 'detail', id] as const,
  myTime: (from: string, to: string) => ['projects', 'time', from, to] as const,
  projectTime: (id: string, from: string, to: string) => ['projects', 'project-time', id, from, to] as const,
};

export const number = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n);

/** The Monday of the week a date falls in, as YYYY-MM-DD. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
