import { Injectable } from '@nestjs/common';
import { hasFeature, type Feature } from '@smart-hr/entitlements';
import type { TenantTransaction } from '@smart-hr/database';
import type { Permission } from '@smart-hr/shared';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { AttendanceService } from '../attendance/attendance.service.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (d: Date) => new Date(`${iso(d)}T00:00:00Z`);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const num = (d: { toString(): string } | null | undefined) =>
  d === null || d === undefined ? 0 : Number(d.toString());
const rupees = (n: number) => Math.round(n * 100) / 100;

export type Tone = 'danger' | 'warning' | 'info';
export interface Alert {
  id: string;
  area: 'HR' | 'FINANCE' | 'PROJECTS';
  tone: Tone;
  title: string;
  detail: string;
  count: number;
  link: string;
}

/** The last six calendar months, oldest first, as `YYYY-MM` keys and short labels. */
function lastMonths(now: Date) {
  const out: { key: string; label: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({
      key: d.toISOString().slice(0, 7),
      label: d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }),
    });
  }
  return out;
}

/**
 * The dashboard's live overview for the organisation: people, money and projects, plus a short list of things
 * that need attention. Each area appears only when the plan includes it and the member holds the permission
 * tenant-wide; an area that can't be built is left out rather than failing the page.
 */
@Injectable()
export class OverviewService {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async overview(tenant: TenantContext, auth: AuthContext, now = new Date()) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const features = await this.entitlements.forTenant(tx);
      const has = (f: Feature) => hasFeature(features, f);
      const can = (p: Permission) => tenant.permissions.allowsTenantWide(p);
      const alerts: Alert[] = [];
      const today = day(now);

      const guard = async <T>(build: () => Promise<T>): Promise<T | null> => {
        try {
          return await build();
        } catch {
          return null;
        }
      };

      const hr =
        has('hr.core') && can('employees.view')
          ? await guard(() => this.hr(tx, has, can, today, now, alerts))
          : null;
      const finance =
        has('finance') && can('finance.view')
          ? await guard(() => this.finance(tx, today, now, alerts))
          : null;
      const projects =
        has('projects') && can('projects.view') ? await guard(() => this.projects(tx, alerts)) : null;

      const rank: Record<Tone, number> = { danger: 0, warning: 1, info: 2 };
      alerts.sort((a, b) => rank[a.tone] - rank[b.tone] || b.count - a.count);
      return { generatedAt: now.toISOString(), hr, finance, projects, alerts };
    });
  }

  private async hr(
    tx: TenantTransaction,
    has: (f: Feature) => boolean,
    can: (p: Permission) => boolean,
    today: Date,
    now: Date,
    alerts: Alert[],
  ) {
    const months = lastMonths(now);
    const since = new Date(`${months[0]!.key}-01T00:00:00Z`);
    const [byStatus, joiners, pendingLeave, onLeaveToday, openRoles] = await Promise.all([
      tx.employee.groupBy({ by: ['status'], _count: { _all: true } }),
      tx.employee.findMany({
        where: { dateOfJoining: { gte: since }, status: { not: 'EXITED' } },
        select: { dateOfJoining: true },
      }),
      has('leave.basic') && can('leave.view')
        ? tx.leaveRequest.count({ where: { status: 'PENDING' } })
        : Promise.resolve(null),
      has('leave.basic') && can('leave.view')
        ? tx.leaveRequest.count({
            where: { status: 'APPROVED', fromDate: { lte: today }, toDate: { gte: today } },
          })
        : Promise.resolve(null),
      has('recruitment') && can('recruitment.view')
        ? tx.jobOpening.count({ where: { status: 'OPEN' } })
        : Promise.resolve(null),
    ]);
    const count = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
    const headcount = count('ACTIVE') + count('ON_NOTICE');
    const joinedByMonth = months.map((m) => ({
      label: m.label,
      value: joiners.filter((j) => iso(j.dateOfJoining).startsWith(m.key)).length,
    }));
    if (pendingLeave) {
      alerts.push({
        id: 'hr-leave',
        area: 'HR',
        tone: 'warning',
        title: `${pendingLeave} leave request${pendingLeave === 1 ? '' : 's'} waiting`,
        detail: 'Decide them so people can plan their time off.',
        count: pendingLeave,
        link: '/approvals',
      });
    }
    if (count('ON_NOTICE') > 0) {
      alerts.push({
        id: 'hr-notice',
        area: 'HR',
        tone: 'info',
        title: `${count('ON_NOTICE')} on notice`,
        detail: 'Plan handovers and exit formalities.',
        count: count('ON_NOTICE'),
        link: '/employees',
      });
    }
    return {
      headcount,
      onNotice: count('ON_NOTICE'),
      joinedLast30: joiners.filter((j) => j.dateOfJoining >= addDays(today, -30)).length,
      joinedByMonth,
      pendingLeave,
      onLeaveToday,
      openRoles,
    };
  }

  private async finance(tx: TenantTransaction, today: Date, now: Date, alerts: Alert[]) {
    const months = lastMonths(now);
    const since = new Date(`${months[0]!.key}-01T00:00:00Z`);
    const [invoices, bills, unmatched, raised] = await Promise.all([
      tx.salesDocument.findMany({
        where: { type: 'INVOICE', status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
        select: { total: true, settled: true, dueDate: true },
      }),
      tx.purchaseBill.findMany({
        where: { type: 'BILL', status: { in: ['POSTED', 'PARTIALLY_PAID'] } },
        select: { total: true, tdsAmount: true, settled: true, dueDate: true },
      }),
      tx.bankStatementLine.count({ where: { status: 'UNMATCHED' } }),
      tx.salesDocument.findMany({
        where: { type: 'INVOICE', status: { not: 'DRAFT' }, date: { gte: since } },
        select: { date: true, total: true, status: true },
      }),
    ]);
    const open = invoices.map((i) => ({ due: i.dueDate, amount: num(i.total) - num(i.settled) }));
    const receivables = open.reduce((n, i) => n + i.amount, 0);
    const overdue = open.filter((i) => i.due && i.due < today);
    const owed = bills.map((b) => ({
      due: b.dueDate,
      amount: num(b.total) - num(b.tdsAmount) - num(b.settled),
    }));
    const payables = owed.reduce((n, b) => n + b.amount, 0);
    const billsOverdue = owed.filter((b) => b.due && b.due < today);
    const billsSoon = owed.filter((b) => b.due && b.due >= today && b.due <= addDays(today, 7));
    const sum = (rows: { amount: number }[]) => rupees(rows.reduce((n, r) => n + r.amount, 0));

    if (overdue.length) {
      alerts.push({
        id: 'fin-overdue-invoices',
        area: 'FINANCE',
        tone: 'danger',
        title: `${overdue.length} overdue invoice${overdue.length === 1 ? '' : 's'}`,
        detail: `₹${rupees(sum(overdue)).toLocaleString('en-IN')} still to collect past the due date.`,
        count: overdue.length,
        link: '/finance/invoices',
      });
    }
    if (billsOverdue.length) {
      alerts.push({
        id: 'fin-overdue-bills',
        area: 'FINANCE',
        tone: 'danger',
        title: `${billsOverdue.length} bill${billsOverdue.length === 1 ? '' : 's'} past due`,
        detail: `₹${sum(billsOverdue).toLocaleString('en-IN')} owed to vendors.`,
        count: billsOverdue.length,
        link: '/finance/bills',
      });
    }
    if (billsSoon.length) {
      alerts.push({
        id: 'fin-bills-soon',
        area: 'FINANCE',
        tone: 'warning',
        title: `${billsSoon.length} bill${billsSoon.length === 1 ? '' : 's'} due this week`,
        detail: `₹${sum(billsSoon).toLocaleString('en-IN')} to pay in the next 7 days.`,
        count: billsSoon.length,
        link: '/finance/bills',
      });
    }
    if (unmatched > 0) {
      alerts.push({
        id: 'fin-bank',
        area: 'FINANCE',
        tone: 'info',
        title: `${unmatched} bank line${unmatched === 1 ? '' : 's'} to match`,
        detail: 'Match them to your books to finish reconciling.',
        count: unmatched,
        link: '/finance/bank',
      });
    }
    const invoicedByMonth = months.map((m) => ({
      label: m.label,
      value: rupees(
        raised
          .filter((r) => iso(r.date).startsWith(m.key) && r.status !== 'CANCELLED')
          .reduce((n, r) => n + num(r.total), 0),
      ),
    }));
    return {
      receivables: rupees(receivables),
      overdueReceivables: sum(overdue),
      overdueInvoices: overdue.length,
      payables: rupees(payables),
      overduePayables: sum(billsOverdue),
      billsDueThisWeek: billsSoon.length,
      unmatchedBankLines: unmatched,
      invoicedByMonth,
    };
  }

  private async projects(tx: TenantTransaction, alerts: Alert[]) {
    const [projects, hours] = await Promise.all([
      tx.project.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, code: true, name: true, budgetHours: true },
      }),
      tx.timeEntry.groupBy({
        by: ['projectId', 'status'],
        where: { project: { status: 'ACTIVE' } },
        _sum: { minutes: true },
      }),
    ]);
    const logged = new Map<string, number>();
    let toApprove = 0;
    for (const h of hours) {
      const m = h._sum.minutes ?? 0;
      logged.set(h.projectId, (logged.get(h.projectId) ?? 0) + m);
      if (h.status === 'OPEN') toApprove += m;
    }
    const rows = projects.map((p) => {
      const budget = p.budgetHours === null ? null : num(p.budgetHours);
      const used = (logged.get(p.id) ?? 0) / 60;
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        budgetHours: budget,
        loggedHours: Math.round(used * 10) / 10,
        percent: budget ? Math.round((used / budget) * 100) : null,
      };
    });
    const over = rows.filter((r) => r.percent !== null && r.percent > 100);
    const close = rows.filter((r) => r.percent !== null && r.percent >= 85 && r.percent <= 100);
    if (over.length) {
      alerts.push({
        id: 'proj-over',
        area: 'PROJECTS',
        tone: 'danger',
        title: `${over.length} project${over.length === 1 ? '' : 's'} over budget`,
        detail: over
          .slice(0, 2)
          .map((p) => p.name)
          .join(', '),
        count: over.length,
        link: '/projects',
      });
    }
    if (close.length) {
      alerts.push({
        id: 'proj-close',
        area: 'PROJECTS',
        tone: 'warning',
        title: `${close.length} project${close.length === 1 ? '' : 's'} nearly out of hours`,
        detail: 'At 85% or more of the hours budgeted.',
        count: close.length,
        link: '/projects',
      });
    }
    const approveHours = Math.round(toApprove / 6) / 10;
    if (approveHours > 0) {
      alerts.push({
        id: 'proj-time',
        area: 'PROJECTS',
        tone: 'info',
        title: `${approveHours} hours of time to approve`,
        detail: 'Timesheets waiting for a project manager.',
        count: Math.ceil(approveHours),
        link: '/projects',
      });
    }
    return {
      active: rows.length,
      overBudget: over.length,
      timeToApproveHours: approveHours,
      busiest: [...rows]
        .sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1) || b.loggedHours - a.loggedHours)
        .slice(0, 5),
    };
  }
}
