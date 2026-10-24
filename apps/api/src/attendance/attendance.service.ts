import { Inject, Injectable } from '@nestjs/common';
import {
  withContext,
  type AttendanceDay,
  type DatabaseClient,
  type Prisma,
  type TenantTransaction,
} from '@smart-hr/database';
import { AppError, ForbiddenError, NotFoundError, type Permission, type ScopeRef } from '@smart-hr/shared';
import type {
  adminPunchSchema,
  attendanceRangeSchema,
  registerQuerySchema,
  teamDayQuerySchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { displayName } from '../employees/employees.service.js';
import { OrgIndex } from '../employees/org-index.js';
import { DATABASE } from '../infra/tokens.js';
import {
  addDays,
  applyOvertimePolicy,
  attendanceDateFor,
  computeDay,
  implicitDay,
  insideLocation,
  localDate,
  weekday,
  zonedInstant,
  type DayResult,
  type GeoLocation,
  type ShiftRule,
} from './attendance-calc.js';
import { loadPolicy } from './attendance-policy.js';
import { DayMarks } from './day-marks.js';

/** Used when an organisation hasn't set up shifts yet: 09:00–18:00 with an hour's break, Sundays off. */
export const FALLBACK_SHIFT: ShiftRule & { code: string; name: string } = {
  id: '',
  code: 'GENERAL',
  name: 'General (09:00–18:00)',
  startMinute: 540,
  endMinute: 1080,
  breakMinutes: 60,
  graceMinutes: 10,
  halfDayMinutes: 240,
  fullDayMinutes: 480,
  weeklyOffs: [0],
};

export const ATTENDANCE_EMPLOYEE_SELECT = {
  id: true,
  tenantId: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  preferredName: true,
  status: true,
  companyId: true,
  branchId: true,
  departmentId: true,
  managerId: true,
  membershipId: true,
  dateOfJoining: true,
  lastWorkingDay: true,
  exitedOn: true,
  company: { select: { timezone: true } },
  branch: { select: { timezone: true } },
  department: { select: { name: true } },
  designation: { select: { name: true } },
} satisfies Prisma.EmployeeSelect;

export type AttendanceEmployee = Prisma.EmployeeGetPayload<{ select: typeof ATTENDANCE_EMPLOYEE_SELECT }>;

type ShiftRow = ShiftRule & { code: string; name: string };

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const toDate = (v: string) => new Date(`${v}T00:00:00Z`);

export function timeZoneOf(e: AttendanceEmployee): string {
  return e.branch?.timezone ?? e.company.timezone;
}

/** The last day someone was employed, if they have left. */
function leftOn(e: AttendanceEmployee): string | null {
  return iso(e.exitedOn ?? (e.status === 'EXITED' ? e.lastWorkingDay : null));
}

/** The most specific place an employee sits, used as the scope of their approval requests. */
export function scopeOfEmployee(tenantId: string, e: AttendanceEmployee): ScopeRef {
  if (e.departmentId) return { type: 'DEPARTMENT', id: e.departmentId };
  if (e.branchId) return { type: 'BRANCH', id: e.branchId };
  if (e.companyId) return { type: 'COMPANY', id: e.companyId };
  return { type: 'TENANT', id: tenantId };
}

/** Loads shifts, assignments and rosters once, then answers "which shift on this date" without more queries. */
export class ShiftBook {
  private constructor(
    private readonly shifts: Map<string, ShiftRow>,
    private readonly fallback: ShiftRow,
    private readonly assignments: Map<string, { from: string; shiftId: string }[]>,
    /** employee → date → the rostered shift, or null for a rostered day off. */
    private readonly rosters: Map<string, Map<string, string | null>>,
  ) {}

  /**
   * `range` limits which roster entries are read. For one employee every entry is read; for a group, the
   * entries within 120 days of today unless the caller names the dates it needs.
   */
  static async load(
    tx: TenantTransaction,
    employeeIds: string[],
    range?: { from: string; to: string },
  ): Promise<ShiftBook> {
    const shifts = await tx.shift.findMany();
    const rows = employeeIds.length
      ? await tx.shiftAssignment.findMany({
          where: { employeeId: { in: employeeIds } },
          orderBy: { effectiveFrom: 'desc' },
          select: { employeeId: true, shiftId: true, effectiveFrom: true },
        })
      : [];
    const byId = new Map(shifts.map((s) => [s.id, s satisfies ShiftRow]));
    const def = shifts.find((s) => s.isDefault && s.status === 'ACTIVE');
    const assignments = new Map<string, { from: string; shiftId: string }[]>();
    for (const r of rows) {
      const list = assignments.get(r.employeeId) ?? [];
      list.push({ from: iso(r.effectiveFrom)!, shiftId: r.shiftId });
      assignments.set(r.employeeId, list);
    }
    const today = new Date();
    const window =
      range ??
      (employeeIds.length === 1
        ? null
        : {
            from: addDays(today.toISOString().slice(0, 10), -120),
            to: addDays(today.toISOString().slice(0, 10), 120),
          });
    const entries = employeeIds.length
      ? await tx.rosterEntry.findMany({
          where: {
            employeeId: { in: employeeIds },
            ...(window ? { date: { gte: toDate(window.from), lte: toDate(window.to) } } : {}),
          },
          select: { employeeId: true, date: true, shiftId: true },
        })
      : [];
    const rosters = new Map<string, Map<string, string | null>>();
    for (const r of entries) {
      const byDate = rosters.get(r.employeeId) ?? new Map<string, string | null>();
      byDate.set(iso(r.date)!, r.shiftId);
      rosters.set(r.employeeId, byDate);
    }
    return new ShiftBook(byId, def ?? FALLBACK_SHIFT, assignments, rosters);
  }

  /**
   * The shift in force for an employee on a date: the roster if it names one, else their latest assignment on
   * or before it, else the default. A rostered day off makes the date a weekly off; a rostered shift makes it
   * a working day even if the shift's usual weekly off falls on it.
   */
  on(employeeId: string, date: string): ShiftRow {
    const hit = this.assignments.get(employeeId)?.find((a) => a.from <= date);
    const base = (hit && this.shifts.get(hit.shiftId)) || this.fallback;
    const rostered = this.rosters.get(employeeId)?.get(date);
    if (rostered === undefined) return base;
    const day = weekday(date);
    if (rostered === null) return { ...base, weeklyOffs: [...new Set([...base.weeklyOffs, day])] };
    const shift = this.shifts.get(rostered) ?? base;
    return { ...shift, weeklyOffs: shift.weeklyOffs.filter((d) => d !== day) };
  }

  current(employeeId: string, today: string): ShiftRow {
    return this.on(employeeId, today);
  }
}

export interface DayView {
  date: string;
  status: AttendanceDay['status'] | null;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  corrected: boolean;
  /** Clocked in, not yet out (today only). */
  open: boolean;
  shift: { code: string; name: string };
  /** The public holiday on this date, if any. */
  holiday: string | null;
}

function storedView(d: AttendanceDay, shift: ShiftRow, open: boolean): DayView {
  return {
    date: iso(d.date)!,
    status: d.status,
    firstIn: d.firstIn?.toISOString() ?? null,
    lastOut: d.lastOut?.toISOString() ?? null,
    workedMinutes: d.workedMinutes,
    lateMinutes: d.lateMinutes,
    earlyLeaveMinutes: d.earlyLeaveMinutes,
    overtimeMinutes: d.overtimeMinutes,
    corrected: d.corrected,
    open,
    shift: { code: shift.code, name: shift.name },
    holiday: null,
  };
}

function emptyView(date: string, status: DayView['status'], shift: ShiftRow): DayView {
  return {
    date,
    status,
    firstIn: null,
    lastOut: null,
    workedMinutes: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    corrected: false,
    open: false,
    shift: { code: shift.code, name: shift.name },
    holiday: null,
  };
}

/**
 * Attendance: clock-ins, daily results, the team view and the monthly register. Visibility follows the
 * employee rules: `attendance.view` in a part of the organisation, plus managers always see the people who
 * report to them (directly or further down), and everyone sees their own.
 */
@Injectable()
export class AttendanceService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly audit: AuditService,
  ) {}

  run<T>(tenant: TenantContext, auth: AuthContext, work: (tx: TenantTransaction) => Promise<T>) {
    return withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, work);
  }

  // ---- Who is who --------------------------------------------------------------------------------

  /** The signed-in member's own employee record, if their account is linked to one. */
  async self(tx: TenantTransaction, tenant: TenantContext): Promise<AttendanceEmployee | null> {
    return tx.employee.findFirst({
      where: { membershipId: tenant.membershipId },
      select: ATTENDANCE_EMPLOYEE_SELECT,
    });
  }

  async requireSelf(tx: TenantTransaction, tenant: TenantContext): Promise<AttendanceEmployee> {
    const me = await this.self(tx, tenant);
    if (!me) {
      throw new AppError(
        'NO_EMPLOYEE_RECORD',
        'Your account isn’t linked to an employee record. Ask HR to link it.',
        404,
      );
    }
    return me;
  }

  /** Everyone below an employee in the reporting line. */
  async reportsOf(tx: TenantTransaction, employeeId: string): Promise<Set<string>> {
    const found = new Set<string>();
    let frontier = [employeeId];
    for (let depth = 0; frontier.length && depth < 20; depth++) {
      const rows = await tx.employee.findMany({
        where: { managerId: { in: frontier } },
        select: { id: true },
      });
      frontier = rows.map((r) => r.id).filter((id) => !found.has(id) && id !== employeeId);
      for (const id of frontier) found.add(id);
    }
    return found;
  }

  /**
   * A `where` for the employees whose attendance (or, with `view` = leave.view, leave) the member may see:
   * the scopes where they hold `view`, and their reporting line. `null` = no restriction.
   */
  async visibleWhere(
    tx: TenantTransaction,
    tenant: TenantContext,
    org: OrgIndex,
    view: Permission = 'attendance.view',
  ): Promise<{ where: Prisma.EmployeeWhereInput | null; any: boolean }> {
    const scoped = org.visibilityFilter(tenant.permissions, view);
    if (scoped === null) return { where: null, any: true };
    const me = await this.self(tx, tenant);
    const reports = me ? [...(await this.reportsOf(tx, me.id))] : [];
    const or: Prisma.EmployeeWhereInput[] = [
      ...scoped.OR,
      ...(reports.length ? [{ id: { in: reports } }] : []),
    ];
    return { where: { OR: or }, any: or.length > 0 };
  }

  /**
   * Loads an employee the member may act on: themself, someone below them in the reporting line (for
   * viewing), or anyone in a scope where they hold `code`. `view` is the module's viewing permission: someone
   * who may see the employee but not do this gets 403; anyone else gets 404, so nothing leaks.
   */
  async loadFor(
    tx: TenantTransaction,
    tenant: TenantContext,
    org: OrgIndex,
    employeeId: string,
    code: Permission,
    view: Permission = 'attendance.view',
  ): Promise<AttendanceEmployee> {
    const e = await tx.employee.findUnique({ where: { id: employeeId }, select: ATTENDANCE_EMPLOYEE_SELECT });
    if (!e) throw new NotFoundError('Employee');
    if (tenant.permissions.allows(code, org.scopesOf(e))) return e;
    if (code === view) {
      if (e.membershipId === tenant.membershipId) return e;
      const me = await this.self(tx, tenant);
      if (me && (await this.reportsOf(tx, me.id)).has(e.id)) return e;
    } else if (tenant.permissions.allows(view, org.scopesOf(e))) {
      throw new ForbiddenError();
    }
    throw new NotFoundError('Employee');
  }

  // ---- Computing days ----------------------------------------------------------------------------

  /**
   * Recomputes and stores one employee's day from their punches. Called after every punch, approved
   * correction and shift change, inside the same transaction.
   */
  async recompute(
    tx: TenantTransaction,
    e: AttendanceEmployee,
    date: string,
    book?: ShiftBook,
    now = new Date(),
  ): Promise<DayResult> {
    const shifts = book ?? (await ShiftBook.load(tx, [e.id]));
    const shift = shifts.on(e.id, date);
    const tz = timeZoneOf(e);
    // Wide enough for night shifts on either side; the exact day is decided per punch.
    const from = new Date(toDate(date).getTime() - 36 * 3_600_000);
    const to = new Date(toDate(date).getTime() + 60 * 3_600_000);
    const punches = (
      await tx.attendancePunch.findMany({
        where: { employeeId: e.id, at: { gte: from, lt: to } },
        orderBy: { at: 'asc' },
        select: { at: true, direction: true, source: true },
      })
    ).filter((p) => attendanceDateFor(p.at, shift, tz) === date);
    const marks = await DayMarks.load(tx, [e], date, date);
    const mark = marks.on(e.id, date);
    const raw = computeDay({ date, shift, punches, timeZone: tz, now, mark });
    const policy = await loadPolicy(tx);
    const offDay = shift.weeklyOffs.includes(weekday(date)) || !!mark.holiday;
    const result: DayResult = {
      ...raw,
      overtimeMinutes: applyOvertimePolicy(raw.overtimeMinutes, policy.overtime, offDay),
    };
    const data = {
      shiftId: shift.id || null,
      status: result.status,
      firstIn: result.firstIn,
      lastOut: result.lastOut,
      workedMinutes: result.workedMinutes,
      lateMinutes: result.lateMinutes,
      earlyLeaveMinutes: result.earlyLeaveMinutes,
      overtimeMinutes: result.overtimeMinutes,
      corrected: punches.some((p) => p.source === 'CORRECTION'),
      computedAt: now,
    };
    await tx.attendanceDay.upsert({
      where: { tenantId_employeeId_date: { tenantId: e.tenantId, employeeId: e.id, date: toDate(date) } },
      create: { tenantId: e.tenantId, employeeId: e.id, date: toDate(date), ...data },
      update: data,
    });
    return result;
  }

  /**
   * A scan from a biometric machine. Machines rarely tell in from out reliably, so the direction follows the
   * employee's day: the first scan is a clock-in, the next a clock-out, and so on. Scans must arrive oldest
   * first for this to hold, which the caller does.
   */
  async addDevicePunch(tx: TenantTransaction, e: AttendanceEmployee, at: Date, now = new Date()) {
    const book = await ShiftBook.load(tx, [e.id]);
    const tz = timeZoneOf(e);
    const date = attendanceDateFor(at, book.on(e.id, localDate(at, tz)), tz);
    const last = await this.lastPunchOn(tx, e.id, date, book.on(e.id, date), tz);
    const direction = last && last.at <= at && last.direction === 'IN' ? 'OUT' : 'IN';
    return this.addPunch(tx, e, { at, direction, source: 'DEVICE', recordedByUserId: null }, now);
  }

  /** Days for one employee over a range: stored results, else absent / weekly off / nothing. */
  async daysFor(
    tx: TenantTransaction,
    e: AttendanceEmployee,
    from: string,
    to: string,
    now = new Date(),
  ): Promise<DayView[]> {
    const book = await ShiftBook.load(tx, [e.id]);
    const stored = await tx.attendanceDay.findMany({
      where: { employeeId: e.id, date: { gte: toDate(from), lte: toDate(to) } },
    });
    const byDate = new Map(stored.map((d) => [iso(d.date)!, d]));
    const marks = await DayMarks.load(tx, [e], from, to);
    const tz = timeZoneOf(e);
    const today = localDate(now, tz);
    const views: DayView[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const shift = book.on(e.id, date);
      const d = byDate.get(date);
      if (d) {
        const open =
          date === attendanceDateFor(now, shift, tz) && !!d.firstIn && (!d.lastOut || d.lastOut < d.firstIn);
        views.push(storedView(d, shift, open && (await this.isOpen(tx, e.id, date, shift, tz))));
      } else {
        const status = implicitDay({
          date,
          shift,
          today,
          joinedOn: iso(e.dateOfJoining)!,
          leftOn: leftOn(e),
          mark: marks.on(e.id, date),
        });
        views.push(emptyView(date, status, shift));
      }
      views[views.length - 1]!.holiday = marks.holiday(e.id, date);
    }
    return views;
  }

  /** Whether the latest punch of a day is a clock-in. */
  private async isOpen(
    tx: TenantTransaction,
    employeeId: string,
    date: string,
    shift: ShiftRule,
    tz: string,
  ) {
    const last = await this.lastPunchOn(tx, employeeId, date, shift, tz);
    return last?.direction === 'IN';
  }

  async lastPunchOn(tx: TenantTransaction, employeeId: string, date: string, shift: ShiftRule, tz: string) {
    const from = new Date(toDate(date).getTime() - 36 * 3_600_000);
    const to = new Date(toDate(date).getTime() + 60 * 3_600_000);
    const punches = await tx.attendancePunch.findMany({
      where: { employeeId, at: { gte: from, lt: to } },
      orderBy: { at: 'desc' },
      select: { at: true, direction: true, source: true },
    });
    return punches.find((p) => attendanceDateFor(p.at, shift, tz) === date) ?? null;
  }

  // ---- Self service ------------------------------------------------------------------------------

  async today(tenant: TenantContext, auth: AuthContext, now = new Date()) {
    return this.run(tenant, auth, async (tx) => {
      const me = await this.self(tx, tenant);
      if (!me) return { employee: null };
      const book = await ShiftBook.load(tx, [me.id]);
      const tz = timeZoneOf(me);
      const shiftToday = book.on(me.id, localDate(now, tz));
      const date = attendanceDateFor(now, shiftToday, tz);
      const shift = book.on(me.id, date);
      const from = new Date(toDate(date).getTime() - 36 * 3_600_000);
      const to = new Date(toDate(date).getTime() + 60 * 3_600_000);
      const punches = (
        await tx.attendancePunch.findMany({
          where: { employeeId: me.id, at: { gte: from, lt: to } },
          orderBy: { at: 'asc' },
          select: { id: true, at: true, direction: true, source: true, note: true },
        })
      ).filter((p) => attendanceDateFor(p.at, shift, tz) === date);
      const marks = await DayMarks.load(tx, [me], date, date);
      const mark = marks.on(me.id, date);
      const result = computeDay({ date, shift, punches, timeZone: tz, now, mark });
      const last = punches.at(-1);
      return {
        employee: { id: me.id, name: displayName(me), employeeCode: me.employeeCode },
        date,
        timeZone: tz,
        holiday: mark.holiday,
        leave: mark.leave,
        shift: {
          code: shift.code,
          name: shift.name,
          startMinute: shift.startMinute,
          endMinute: shift.endMinute,
          graceMinutes: shift.graceMinutes,
        },
        punches: punches.map((p) => ({ ...p, at: p.at.toISOString() })),
        result: {
          ...result,
          firstIn: result.firstIn?.toISOString() ?? null,
          lastOut: result.lastOut?.toISOString() ?? null,
          openSince: result.openSince?.toISOString() ?? null,
        },
        nextAction: last?.direction === 'IN' ? ('OUT' as const) : ('IN' as const),
        canPunch: me.status !== 'EXITED',
        // Whether the browser should share its location with the clock-in.
        geofence:
          (await loadPolicy(tx)).geofenceMode !== 'OFF' &&
          (await tx.workLocation.count({ where: { status: 'ACTIVE' } })) > 0
            ? (await loadPolicy(tx)).geofenceMode
            : 'OFF',
      };
    });
  }

  async punch(
    tenant: TenantContext,
    auth: AuthContext,
    direction: 'IN' | 'OUT',
    now = new Date(),
    location?: { latitude: number; longitude: number; accuracy?: number | undefined },
  ) {
    await this.run(tenant, auth, async (tx) => {
      const me = await this.requireSelf(tx, tenant);
      if (me.status === 'EXITED')
        throw new AppError('EMPLOYEE_EXITED', 'You have left the organisation', 409);
      const where = await this.checkLocation(tx, location);
      await this.addPunch(
        tx,
        me,
        { at: now, direction, source: 'WEB', recordedByUserId: auth.user.id, where },
        now,
      );
    });
    return this.today(tenant, auth, now);
  }

  /**
   * Applies the organisation's geofence rule to a self clock-in or clock-out. With no work locations set up
   * there is nothing to check against, so the rule does not apply. When the rule is on, a punch must say where
   * it came from; enforcing refuses one outside every work location, warning only flags it.
   */
  private async checkLocation(
    tx: TenantTransaction,
    location: { latitude: number; longitude: number; accuracy?: number | undefined } | undefined,
  ) {
    const policy = await loadPolicy(tx);
    if (policy.geofenceMode === 'OFF') return undefined;
    const rows = await tx.workLocation.findMany({ where: { status: 'ACTIVE' } });
    if (rows.length === 0) return undefined;
    if (!location) {
      if (policy.geofenceMode === 'ENFORCE') {
        throw new AppError(
          'LOCATION_REQUIRED',
          'Your organisation needs your location to clock in. Allow location access in your browser and try again.',
          422,
        );
      }
      return undefined;
    }
    const places: GeoLocation[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      radiusMeters: r.radiusMeters,
    }));
    const inside = insideLocation(location, places);
    if (!inside && policy.geofenceMode === 'ENFORCE') {
      throw new AppError(
        'OUTSIDE_WORK_LOCATION',
        'You’re not at a work location. Move closer to the office, or ask HR to add a correction.',
        422,
      );
    }
    return {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracyMeters: location.accuracy === undefined ? null : Math.round(location.accuracy),
      locationId: inside?.id ?? null,
      outsideGeofence: !inside,
    };
  }

  /**
   * Adds a punch after checking it alternates with the last one of its day, then recomputes that day.
   * Serialised per employee so two quick clicks can't both clock in.
   */
  async addPunch(
    tx: TenantTransaction,
    e: AttendanceEmployee,
    p: {
      at: Date;
      direction: 'IN' | 'OUT';
      source: 'WEB' | 'ADMIN' | 'CORRECTION' | 'IMPORT' | 'DEVICE';
      note?: string;
      recordedByUserId: string | null;
      correctionId?: string;
      where?:
        | {
            latitude: number;
            longitude: number;
            accuracyMeters: number | null;
            locationId: string | null;
            outsideGeofence: boolean;
          }
        | undefined;
    },
    now = new Date(),
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`punch:${e.id}`}))`;
    const book = await ShiftBook.load(tx, [e.id]);
    const tz = timeZoneOf(e);
    const shift = book.on(e.id, localDate(p.at, tz));
    const date = attendanceDateFor(p.at, shift, tz);
    if (p.source !== 'CORRECTION') {
      const last = await this.lastPunchOn(tx, e.id, date, book.on(e.id, date), tz);
      const lastBefore = last && last.at <= p.at ? last : null;
      if (
        lastBefore?.direction === p.direction ||
        (!lastBefore && p.direction === 'OUT' && p.source === 'WEB')
      ) {
        throw new AppError(
          p.direction === 'IN' ? 'ALREADY_CLOCKED_IN' : 'NOT_CLOCKED_IN',
          p.direction === 'IN' ? 'You’re already clocked in.' : 'You haven’t clocked in yet today.',
          409,
        );
      }
    }
    await tx.attendancePunch.create({
      data: {
        tenantId: e.tenantId,
        employeeId: e.id,
        at: p.at,
        direction: p.direction,
        source: p.source,
        note: p.note ?? null,
        recordedByUserId: p.recordedByUserId,
        correctionId: p.correctionId ?? null,
        ...(p.where
          ? {
              latitude: p.where.latitude,
              longitude: p.where.longitude,
              accuracyMeters: p.where.accuracyMeters,
              locationId: p.where.locationId,
              outsideGeofence: p.where.outsideGeofence,
            }
          : {}),
      },
    });
    await this.recompute(tx, e, date, book, now);
    return date;
  }

  async myDays(tenant: TenantContext, auth: AuthContext, q: z.output<typeof attendanceRangeSchema>) {
    return this.run(tenant, auth, async (tx) => {
      const me = await this.requireSelf(tx, tenant);
      return { employeeId: me.id, days: await this.daysFor(tx, me, q.from, q.to) };
    });
  }

  async employeeDays(
    tenant: TenantContext,
    auth: AuthContext,
    employeeId: string,
    q: z.output<typeof attendanceRangeSchema>,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const e = await this.loadFor(tx, tenant, org, employeeId, 'attendance.view');
      return {
        employee: { id: e.id, name: displayName(e), employeeCode: e.employeeCode },
        days: await this.daysFor(tx, e, q.from, q.to),
      };
    });
  }

  // ---- Team --------------------------------------------------------------------------------------

  async visibleEmployees(
    tx: TenantTransaction,
    tenant: TenantContext,
    filters: {
      companyId?: string | undefined;
      branchId?: string | undefined;
      departmentId?: string | undefined;
      search?: string | undefined;
    },
    activeBetween: { from: string; to: string },
  ) {
    const org = await OrgIndex.load(tx, tenant.id);
    const visible = await this.visibleWhere(tx, tenant, org);
    if (!visible.any) throw new ForbiddenError();
    const terms = (filters.search ?? '').split(/\s+/).filter(Boolean).slice(0, 5);
    const where: Prisma.EmployeeWhereInput = {
      AND: [
        ...(visible.where ? [visible.where] : []),
        { dateOfJoining: { lte: toDate(activeBetween.to) } },
        { OR: [{ status: { not: 'EXITED' } }, { exitedOn: { gte: toDate(activeBetween.from) } }] },
        ...(filters.companyId ? [{ companyId: filters.companyId }] : []),
        ...(filters.branchId ? [{ branchId: filters.branchId }] : []),
        ...(filters.departmentId ? [{ departmentId: filters.departmentId }] : []),
        ...terms.map((t) => ({
          OR: [
            { firstName: { contains: t, mode: 'insensitive' as const } },
            { lastName: { contains: t, mode: 'insensitive' as const } },
            { employeeCode: { contains: t, mode: 'insensitive' as const } },
          ],
        })),
      ],
    };
    return { where, org };
  }

  async team(
    tenant: TenantContext,
    auth: AuthContext,
    q: z.output<typeof teamDayQuerySchema>,
    now = new Date(),
  ) {
    return this.run(tenant, auth, async (tx) => {
      const { where } = await this.visibleEmployees(tx, tenant, q, { from: q.date, to: q.date });
      const employees = await tx.employee.findMany({
        where,
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        take: 1000,
        select: ATTENDANCE_EMPLOYEE_SELECT,
      });
      const ids = employees.map((e) => e.id);
      const book = await ShiftBook.load(tx, ids);
      const stored = await tx.attendanceDay.findMany({
        where: { employeeId: { in: ids }, date: toDate(q.date) },
      });
      const byEmployee = new Map(stored.map((d) => [d.employeeId, d]));
      const marks = await DayMarks.load(tx, employees, q.date, q.date);
      const rows = employees.map((e) => {
        const shift = book.on(e.id, q.date);
        const tz = timeZoneOf(e);
        const d = byEmployee.get(e.id);
        const view = d
          ? storedView(d, shift, false)
          : emptyView(
              q.date,
              implicitDay({
                date: q.date,
                shift,
                today: localDate(now, tz),
                joinedOn: iso(e.dateOfJoining)!,
                leftOn: leftOn(e),
                mark: marks.on(e.id, q.date),
              }),
              shift,
            );
        view.holiday = marks.holiday(e.id, q.date);
        return {
          employee: {
            id: e.id,
            name: displayName(e),
            employeeCode: e.employeeCode,
            department: e.department?.name ?? null,
            designation: e.designation?.name ?? null,
            timeZone: tz,
          },
          day: view,
        };
      });
      const counts = {
        total: rows.length,
        present: rows.filter((r) => r.day.status === 'PRESENT').length,
        halfDay: rows.filter((r) => r.day.status === 'HALF_DAY').length,
        absent: rows.filter((r) => r.day.status === 'ABSENT').length,
        late: rows.filter((r) => r.day.lateMinutes > 0).length,
        notIn: rows.filter((r) => r.day.status === null).length,
        weeklyOff: rows.filter((r) => r.day.status === 'WEEKLY_OFF').length,
        holiday: rows.filter((r) => r.day.status === 'HOLIDAY').length,
        onLeave: rows.filter((r) => r.day.status === 'ON_LEAVE').length,
      };
      const filtered = q.status
        ? rows.filter((r) =>
            q.status === 'LATE'
              ? r.day.lateMinutes > 0
              : q.status === 'NOT_IN'
                ? r.day.status === null
                : r.day.status === q.status,
          )
        : rows;
      return { date: q.date, counts, rows: filtered };
    });
  }

  /** A month as a grid: one row per employee, one status per day, with totals. */
  async register(
    tenant: TenantContext,
    auth: AuthContext,
    q: z.output<typeof registerQuerySchema>,
    now = new Date(),
  ) {
    const from = `${q.month}-01`;
    const to = addDays(addDays(`${q.month}-28`, 4).slice(0, 7) + '-01', -1);
    return this.run(tenant, auth, async (tx) => {
      const { where } = await this.visibleEmployees(tx, tenant, q, { from, to });
      const total = await tx.employee.count({ where });
      const employees = await tx.employee.findMany({
        where,
        orderBy: [{ employeeCode: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: ATTENDANCE_EMPLOYEE_SELECT,
      });
      const ids = employees.map((e) => e.id);
      const book = await ShiftBook.load(tx, ids);
      const stored = await tx.attendanceDay.findMany({
        where: { employeeId: { in: ids }, date: { gte: toDate(from), lte: toDate(to) } },
        select: { employeeId: true, date: true, status: true, lateMinutes: true, overtimeMinutes: true },
      });
      const key = (employeeId: string, date: string) => `${employeeId}:${date}`;
      const byKey = new Map(stored.map((d) => [key(d.employeeId, iso(d.date)!), d]));
      const marks = await DayMarks.load(tx, employees, from, to);
      const dates: string[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
      const rows = employees.map((e) => {
        const tz = timeZoneOf(e);
        const today = localDate(now, tz);
        const totals = {
          present: 0,
          halfDay: 0,
          absent: 0,
          weeklyOff: 0,
          holiday: 0,
          onLeave: 0,
          late: 0,
          overtimeMinutes: 0,
        };
        const days = dates.map((date) => {
          const d = byKey.get(key(e.id, date));
          const status = d
            ? d.status
            : implicitDay({
                date,
                shift: book.on(e.id, date),
                today,
                joinedOn: iso(e.dateOfJoining)!,
                leftOn: leftOn(e),
                mark: marks.on(e.id, date),
              });
          if (status === 'PRESENT') totals.present++;
          else if (status === 'HALF_DAY') totals.halfDay++;
          else if (status === 'ABSENT') totals.absent++;
          else if (status === 'WEEKLY_OFF') totals.weeklyOff++;
          else if (status === 'HOLIDAY') totals.holiday++;
          else if (status === 'ON_LEAVE') totals.onLeave++;
          if (d && d.lateMinutes > 0) totals.late++;
          totals.overtimeMinutes += d?.overtimeMinutes ?? 0;
          return { date, status, late: !!d && d.lateMinutes > 0 };
        });
        return {
          employee: {
            id: e.id,
            name: displayName(e),
            employeeCode: e.employeeCode,
            department: e.department?.name ?? null,
          },
          days,
          totals,
        };
      });
      return { month: q.month, dates, total, page: q.page, pageSize: q.pageSize, rows };
    });
  }

  // ---- On someone's behalf -----------------------------------------------------------------------

  async recordPunch(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof adminPunchSchema>,
    meta: RequestMeta,
    now = new Date(),
  ) {
    return this.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const e = await this.loadFor(tx, tenant, org, input.employeeId, 'attendance.manage');
      const at = zonedInstant(input.date, input.time, timeZoneOf(e));
      if (at.getTime() > now.getTime() + 5 * 60_000) {
        throw new AppError('VALIDATION_FAILED', 'This time hasn’t happened yet', 400, [
          { path: 'time', message: 'Can’t be in the future' },
        ]);
      }
      if (e.membershipId === tenant.membershipId) {
        throw new AppError(
          'SEPARATION_OF_DUTIES',
          'You can’t record your own attendance this way. Clock in yourself, or ask for a correction.',
          403,
        );
      }
      const date = await this.addPunch(
        tx,
        e,
        { at, direction: input.direction, source: 'ADMIN', note: input.note, recordedByUserId: auth.user.id },
        now,
      );
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'attendance.punch.record',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'employee',
          targetId: e.id,
          metadata: { date, direction: input.direction, at: at.toISOString() },
        },
        meta,
      );
      return { date, days: await this.daysFor(tx, e, date, date, now) };
    });
  }
}
