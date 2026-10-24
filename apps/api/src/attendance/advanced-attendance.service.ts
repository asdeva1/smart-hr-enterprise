import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '@smart-hr/database';
import { AppError, ForbiddenError } from '@smart-hr/shared';
import type {
  attendancePolicySchema,
  clearRosterSchema,
  decideOvertimeSchema,
  overtimeQuerySchema,
  rosterQuerySchema,
  setRosterSchema,
  updateWorkLocationSchema,
  workLocationSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { displayName } from '../employees/employees.service.js';
import { addDays, localDate, weekday } from './attendance-calc.js';
import { loadPolicy } from './attendance-policy.js';
import {
  ATTENDANCE_EMPLOYEE_SELECT,
  AttendanceService,
  ShiftBook,
  timeZoneOf,
  toDate,
  type AttendanceEmployee,
} from './attendance.service.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);

function datesBetween(from: string, to: string, weekdays?: readonly number[]): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!weekdays || weekdays.length === 0 || weekdays.includes(weekday(d))) out.push(d);
  }
  return out;
}

/**
 * Rosters, overtime approval, the attendance rules and work locations. Plan-gated by the controller
 * (attendance.advanced). Changes that affect past or current days recompute those days in the same
 * transaction, so the register never disagrees with the roster.
 */
@Injectable()
export class AdvancedAttendanceService {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly audit: AuditService,
  ) {}

  // ---- Rules and locations ----------------------------------------------------------------------

  async getPolicy(tenant: TenantContext, auth: AuthContext) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const policy = await loadPolicy(tx);
      return {
        configured: policy.configured,
        overtimeEnabled: policy.overtime.enabled,
        overtimeThresholdMinutes: policy.overtime.thresholdMinutes,
        overtimeRoundMinutes: policy.overtime.roundMinutes,
        overtimeDailyCapMinutes: policy.overtime.dailyCapMinutes,
        overtimeOffDayCounts: policy.overtime.offDayCounts,
        overtimeNeedsApproval: policy.overtimeNeedsApproval,
        maxCorrectionsPerMonth: policy.maxCorrectionsPerMonth,
        maxCorrectionBackdateDays: policy.maxCorrectionBackdateDays,
        geofenceMode: policy.geofenceMode,
      };
    });
  }

  async savePolicy(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof attendancePolicySchema>,
    meta: RequestMeta,
  ) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const data = { ...input, updatedByUserId: auth.user.id };
      await tx.attendancePolicy.upsert({
        where: { tenantId: tenant.id },
        create: { tenantId: tenant.id, ...data },
        update: data,
      });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'attendance.policy.update',
          outcome: 'SUCCESS',
          actorUserId: auth.user.id,
          tenantId: tenant.id,
          targetType: 'attendance_policy',
          targetId: tenant.id,
          metadata: { geofenceMode: input.geofenceMode, overtimeEnabled: input.overtimeEnabled },
        },
        meta,
      );
      return { ok: true };
    });
  }

  async locations(tenant: TenantContext, auth: AuthContext) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const rows = await tx.workLocation.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }] });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        latitude: Number(r.latitude),
        longitude: Number(r.longitude),
        radiusMeters: r.radiusMeters,
        status: r.status,
      }));
    });
  }

  async createLocation(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof workLocationSchema>,
    meta: RequestMeta,
  ) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const clash = await tx.workLocation.findFirst({ where: { name: input.name }, select: { id: true } });
      if (clash) {
        throw new AppError('CONFLICT', 'There is already a place with this name', 409, [
          { path: 'name', message: 'Already in use' },
        ]);
      }
      const row = await tx.workLocation.create({ data: { tenantId: tenant.id, ...input } });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'attendance.location.create',
          outcome: 'SUCCESS',
          actorUserId: auth.user.id,
          tenantId: tenant.id,
          targetType: 'work_location',
          targetId: row.id,
          metadata: { name: row.name, radiusMeters: row.radiusMeters },
        },
        meta,
      );
      return { id: row.id };
    });
  }

  async updateLocation(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateWorkLocationSchema>,
    meta: RequestMeta,
  ) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const clash = await tx.workLocation.findFirst({
        where: { name: input.name, id: { not: id } },
        select: { id: true },
      });
      if (clash) {
        throw new AppError('CONFLICT', 'There is already a place with this name', 409, [
          { path: 'name', message: 'Already in use' },
        ]);
      }
      const updated = await tx.workLocation.updateMany({
        where: { id },
        data: {
          name: input.name,
          latitude: input.latitude,
          longitude: input.longitude,
          radiusMeters: input.radiusMeters,
          ...(input.status ? { status: input.status } : {}),
        },
      });
      if (updated.count !== 1) throw new AppError('NOT_FOUND', 'Place not found', 404);
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'attendance.location.update',
          outcome: 'SUCCESS',
          actorUserId: auth.user.id,
          tenantId: tenant.id,
          targetType: 'work_location',
          targetId: id,
          metadata: { name: input.name, status: input.status ?? null },
        },
        meta,
      );
      return { ok: true };
    });
  }

  // ---- Rosters ----------------------------------------------------------------------------------

  /** Who is on which shift for each date, for the people the requester may manage. */
  async roster(tenant: TenantContext, auth: AuthContext, q: z.output<typeof rosterQuerySchema>) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const { where } = await this.attendance.visibleEmployees(tx, tenant, q, { from: q.from, to: q.to });
      const employees = await tx.employee.findMany({
        where,
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        take: 300,
        select: { id: true, employeeCode: true, firstName: true, lastName: true, preferredName: true },
      });
      const ids = employees.map((e) => e.id);
      const book = await ShiftBook.load(tx, ids, { from: q.from, to: q.to });
      const entries = await tx.rosterEntry.findMany({
        where: { employeeId: { in: ids }, date: { gte: toDate(q.from), lte: toDate(q.to) } },
        select: { employeeId: true, date: true, shiftId: true },
      });
      const rostered = new Map(entries.map((r) => [`${r.employeeId}:${iso(r.date)}`, r.shiftId]));
      const shifts = await tx.shift.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true, startMinute: true, endMinute: true },
      });
      const dates = datesBetween(q.from, q.to);
      return {
        dates,
        shifts,
        employees: employees.map((e) => ({
          id: e.id,
          employeeCode: e.employeeCode,
          name: displayName(e),
          days: dates.map((date) => {
            const key = `${e.id}:${date}`;
            const isRostered = rostered.has(key);
            const shift = book.on(e.id, date);
            const off = shift.weeklyOffs.includes(weekday(date));
            return {
              date,
              rostered: isRostered,
              /** The shift worked that day, or null for a day off. */
              shiftId: off ? null : shift.id || null,
              shiftCode: off ? null : shift.code,
            };
          }),
        })),
      };
    });
  }

  private async rosterTargets(
    tx: TenantTransaction,
    tenant: TenantContext,
    employeeIds: string[],
    from: string,
    to: string,
  ): Promise<AttendanceEmployee[]> {
    const { where } = await this.attendance.visibleEmployees(tx, tenant, {}, { from, to });
    const found = await tx.employee.findMany({
      where: { AND: [where, { id: { in: employeeIds } }] },
      select: ATTENDANCE_EMPLOYEE_SELECT,
    });
    if (found.length !== new Set(employeeIds).size) throw new ForbiddenError();
    return found;
  }

  /** Recomputes the dates of a changed roster that have already started (in each person's time zone). */
  private async refresh(
    tx: TenantTransaction,
    people: AttendanceEmployee[],
    dates: string[],
    now: Date,
  ): Promise<void> {
    for (const e of people) {
      const today = localDate(now, timeZoneOf(e));
      const past = dates.filter((d) => d <= today);
      if (past.length === 0) continue;
      const book = await ShiftBook.load(tx, [e.id]);
      for (const d of past) await this.attendance.recompute(tx, e, d, book, now);
    }
  }

  async setRoster(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof setRosterSchema>,
    meta: RequestMeta,
    now = new Date(),
  ) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const people = await this.rosterTargets(tx, tenant, input.employeeIds, input.from, input.to);
      if (input.shiftId) {
        const shift = await tx.shift.findFirst({
          where: { id: input.shiftId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!shift) throw new AppError('NOT_FOUND', 'That shift isn’t available', 404);
      }
      const dates = datesBetween(input.from, input.to, input.weekdays);
      if (dates.length === 0) throw new AppError('VALIDATION_FAILED', 'No dates match those weekdays', 400);
      for (const e of people) {
        for (const d of dates) {
          if (d < iso(e.dateOfJoining)) continue;
          await tx.rosterEntry.upsert({
            where: { tenantId_employeeId_date: { tenantId: tenant.id, employeeId: e.id, date: toDate(d) } },
            create: {
              tenantId: tenant.id,
              employeeId: e.id,
              date: toDate(d),
              shiftId: input.shiftId,
              createdByUserId: auth.user.id,
            },
            update: { shiftId: input.shiftId, createdByUserId: auth.user.id },
          });
        }
      }
      await this.refresh(tx, people, dates, now);
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'attendance.roster.set',
          outcome: 'SUCCESS',
          actorUserId: auth.user.id,
          tenantId: tenant.id,
          targetType: 'roster',
          targetId: tenant.id,
          metadata: { people: people.length, dates: dates.length, shiftId: input.shiftId },
        },
        meta,
      );
      return { people: people.length, days: dates.length };
    });
  }

  async clearRoster(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof clearRosterSchema>,
    meta: RequestMeta,
    now = new Date(),
  ) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const people = await this.rosterTargets(tx, tenant, input.employeeIds, input.from, input.to);
      const removed = await tx.rosterEntry.deleteMany({
        where: {
          employeeId: { in: people.map((p) => p.id) },
          date: { gte: toDate(input.from), lte: toDate(input.to) },
        },
      });
      await this.refresh(tx, people, datesBetween(input.from, input.to), now);
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'attendance.roster.clear',
          outcome: 'SUCCESS',
          actorUserId: auth.user.id,
          tenantId: tenant.id,
          targetType: 'roster',
          targetId: tenant.id,
          metadata: { people: people.length, removed: removed.count },
        },
        meta,
      );
      return { removed: removed.count };
    });
  }

  // ---- Overtime ---------------------------------------------------------------------------------

  async overtime(tenant: TenantContext, auth: AuthContext, q: z.output<typeof overtimeQuerySchema>) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const policy = await loadPolicy(tx);
      const { where } = await this.attendance.visibleEmployees(tx, tenant, {}, { from: q.from, to: q.to });
      const days = await tx.attendanceDay.findMany({
        where: {
          date: { gte: toDate(q.from), lte: toDate(q.to) },
          overtimeMinutes: { gt: 0 },
          employee: where,
        },
        orderBy: [{ date: 'desc' }],
        take: 500,
        include: {
          employee: {
            select: { id: true, employeeCode: true, firstName: true, lastName: true, preferredName: true },
          },
        },
      });
      const approvals = await tx.overtimeApproval.findMany({
        where: {
          date: { gte: toDate(q.from), lte: toDate(q.to) },
          employeeId: { in: days.map((d) => d.employeeId) },
        },
      });
      const decided = new Map(approvals.map((a) => [`${a.employeeId}:${iso(a.date)}`, a]));
      const rows = days.map((d) => {
        const a = decided.get(`${d.employeeId}:${iso(d.date)}`);
        return {
          employeeId: d.employeeId,
          employeeCode: d.employee.employeeCode,
          name: displayName(d.employee),
          date: iso(d.date),
          workedMinutes: d.workedMinutes,
          overtimeMinutes: d.overtimeMinutes,
          decision: a?.decision ?? (policy.overtimeNeedsApproval ? ('PENDING' as const) : ('AUTO' as const)),
          approvedMinutes: a?.approvedMinutes ?? (policy.overtimeNeedsApproval ? 0 : d.overtimeMinutes),
          note: a?.note ?? null,
        };
      });
      const filtered =
        q.status === 'ALL'
          ? rows
          : rows.filter((r) =>
              q.status === 'PENDING' ? r.decision === 'PENDING' : r.decision !== 'PENDING',
            );
      return {
        needsApproval: policy.overtimeNeedsApproval,
        rows: filtered,
        totals: {
          pendingMinutes: rows
            .filter((r) => r.decision === 'PENDING')
            .reduce((n, r) => n + r.overtimeMinutes, 0),
          approvedMinutes: rows.reduce((n, r) => n + r.approvedMinutes, 0),
        },
      };
    });
  }

  async decideOvertime(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof decideOvertimeSchema>,
    meta: RequestMeta,
  ) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const [target] = await this.rosterTargets(tx, tenant, [input.employeeId], input.date, input.date);
      if (!target) throw new ForbiddenError();
      if (target.membershipId === tenant.membershipId) {
        throw new AppError('SELF_APPROVAL', 'You can’t decide your own overtime.', 403);
      }
      const day = await tx.attendanceDay.findUnique({
        where: {
          tenantId_employeeId_date: {
            tenantId: tenant.id,
            employeeId: input.employeeId,
            date: toDate(input.date),
          },
        },
        select: { overtimeMinutes: true },
      });
      if (!day || day.overtimeMinutes <= 0) {
        throw new AppError('NOT_FOUND', 'There is no overtime on that day.', 404);
      }
      const minutes =
        input.decision === 'APPROVED'
          ? Math.min(input.minutes ?? day.overtimeMinutes, day.overtimeMinutes)
          : 0;
      const data = {
        decision: input.decision,
        approvedMinutes: minutes,
        note: input.note ?? null,
        decidedByUserId: auth.user.id,
        decidedAt: new Date(),
      };
      await tx.overtimeApproval.upsert({
        where: {
          tenantId_employeeId_date: {
            tenantId: tenant.id,
            employeeId: input.employeeId,
            date: toDate(input.date),
          },
        },
        create: { tenantId: tenant.id, employeeId: input.employeeId, date: toDate(input.date), ...data },
        update: data,
      });
      await this.audit.recordInTransaction(
        tx,
        {
          action: `attendance.overtime.${input.decision.toLowerCase()}`,
          outcome: 'SUCCESS',
          actorUserId: auth.user.id,
          tenantId: tenant.id,
          targetType: 'overtime_approval',
          targetId: input.employeeId,
          metadata: { date: input.date, minutes },
        },
        meta,
      );
      return { approvedMinutes: minutes };
    });
  }
}
