import type { TenantTransaction } from '@smart-hr/database';
import { addDays, NO_MARK, type DayMark } from './attendance-calc.js';

interface Placed {
  id: string;
  companyId: string | null;
  branchId: string | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (v: string) => new Date(`${v}T00:00:00Z`);

/**
 * Holidays and approved leave for a set of employees over a date range, loaded once. An employee follows
 * their branch's holiday calendar, else their company's, else the organisation's; archived calendars and
 * optional (restricted) holidays don't make a day a holiday.
 */
export class DayMarks {
  private constructor(
    private readonly holidays: Map<string, Map<string, string>>,
    private readonly calendarOf: Map<string, string | null>,
    private readonly leave: Map<string, { half: DayMark['leave']; onRestDays: boolean }>,
  ) {}

  static async load(tx: TenantTransaction, employees: Placed[], from: string, to: string): Promise<DayMarks> {
    const calendars = await tx.holidayCalendar.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, scopeKey: true },
    });
    const byScope = new Map(calendars.map((c) => [c.scopeKey, c.id]));
    const calendarOf = new Map<string, string | null>();
    for (const e of employees) {
      calendarOf.set(
        e.id,
        (e.branchId && byScope.get(`BRANCH:${e.branchId}`)) ||
          (e.companyId && byScope.get(`COMPANY:${e.companyId}`)) ||
          byScope.get('TENANT') ||
          null,
      );
    }
    const used = [...new Set([...calendarOf.values()].filter((c): c is string => !!c))];
    const rows = used.length
      ? await tx.holiday.findMany({
          where: { calendarId: { in: used }, optional: false, date: { gte: toDate(from), lte: toDate(to) } },
          select: { calendarId: true, date: true, name: true },
        })
      : [];
    const holidays = new Map<string, Map<string, string>>();
    for (const h of rows) {
      const days = holidays.get(h.calendarId) ?? new Map<string, string>();
      days.set(iso(h.date), h.name);
      holidays.set(h.calendarId, days);
    }

    const requests = employees.length
      ? await tx.leaveRequest.findMany({
          where: {
            employeeId: { in: employees.map((e) => e.id) },
            status: 'APPROVED',
            fromDate: { lte: toDate(to) },
            toDate: { gte: toDate(from) },
          },
          select: {
            employeeId: true,
            fromDate: true,
            toDate: true,
            halfDay: true,
            leaveType: { select: { includeNonWorkingDays: true } },
          },
        })
      : [];
    const leave = new Map<string, { half: DayMark['leave']; onRestDays: boolean }>();
    for (const r of requests) {
      for (let d = iso(r.fromDate); d <= iso(r.toDate); d = addDays(d, 1)) {
        leave.set(`${r.employeeId}:${d}`, {
          half: r.halfDay ?? 'FULL',
          onRestDays: r.leaveType.includeNonWorkingDays,
        });
      }
    }
    return new DayMarks(holidays, calendarOf, leave);
  }

  /** The holiday name on a date for an employee, if their calendar has one. */
  holiday(employeeId: string, date: string): string | null {
    const calendar = this.calendarOf.get(employeeId);
    return (calendar && this.holidays.get(calendar)?.get(date)) || null;
  }

  on(employeeId: string, date: string): DayMark {
    const holiday = this.holiday(employeeId, date);
    const leave = this.leave.get(`${employeeId}:${date}`);
    if (!holiday && !leave) return NO_MARK;
    return { holiday, leave: leave?.half ?? null, leaveOnRestDays: leave?.onRestDays ?? false };
  }
}
