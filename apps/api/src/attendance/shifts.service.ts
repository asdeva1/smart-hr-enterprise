import { Injectable } from '@nestjs/common';
import { isUniqueViolation, type Prisma } from '@smart-hr/database';
import { AppError, ForbiddenError, NotFoundError } from '@smart-hr/shared';
import {
  formatMinutes,
  type assignShiftSchema,
  type createShiftSchema,
  type updateShiftSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { OrgIndex } from '../employees/org-index.js';
import { addDays, localDate } from './attendance-calc.js';
import {
  ATTENDANCE_EMPLOYEE_SELECT,
  AttendanceService,
  FALLBACK_SHIFT,
  ShiftBook,
  timeZoneOf,
  toDate,
} from './attendance.service.js';

type ShiftInput = z.output<typeof createShiftSchema>;

function present(s: {
  id: string;
  code: string;
  name: string;
  startMinute: number;
  endMinute: number;
  breakMinutes: number;
  graceMinutes: number;
  halfDayMinutes: number;
  fullDayMinutes: number;
  weeklyOffs: number[];
  isDefault: boolean;
  status: string;
}) {
  return { ...s, start: formatMinutes(s.startMinute), end: formatMinutes(s.endMinute) };
}

/** How far back a shift change recomputes stored days. Older days are left as they were computed. */
const RECOMPUTE_DAYS = 62;

@Injectable()
export class ShiftsService {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly audit: AuditService,
  ) {}

  private requireConfigure(tenant: TenantContext) {
    if (!tenant.permissions.allowsTenantWide('attendance.configure')) throw new ForbiddenError();
  }

  async list(tenant: TenantContext, auth: AuthContext) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const shifts = await tx.shift.findMany({ orderBy: [{ status: 'asc' }, { code: 'asc' }] });
      // Current employees per shift, by each one's latest assignment that has started.
      const rows = await tx.$queryRaw<{ shift_id: string; n: bigint }[]>`
        SELECT latest.shift_id, count(*) AS n FROM (
          SELECT DISTINCT ON (a.employee_id) a.employee_id, a.shift_id
          FROM shift_assignment a JOIN employee e ON e.id = a.employee_id
          WHERE e.status <> 'EXITED' AND a.effective_from <= current_date
          ORDER BY a.employee_id, a.effective_from DESC
        ) latest GROUP BY latest.shift_id`;
      const counts = new Map(rows.map((r) => [r.shift_id, Number(r.n)]));
      return {
        shifts: shifts.map((s) => ({ ...present(s), assigned: counts.get(s.id) ?? 0 })),
        // Until a default shift exists, employees without an assignment work the built-in general shift.
        fallback: shifts.some((s) => s.isDefault && s.status === 'ACTIVE')
          ? null
          : present({ ...FALLBACK_SHIFT, isDefault: true, status: 'ACTIVE' }),
      };
    });
  }

  async create(tenant: TenantContext, auth: AuthContext, input: ShiftInput, meta: RequestMeta) {
    this.requireConfigure(tenant);
    return this.attendance.run(tenant, auth, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('shift-default'))`;
      if (input.isDefault)
        await tx.shift.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      let shift;
      try {
        shift = await tx.shift.create({ data: { tenantId: tenant.id, ...this.columns(input) } });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError('CODE_TAKEN', 'Another shift already uses this code', 409, [
            { path: 'code', message: 'Already in use' },
          ]);
        }
        throw error;
      }
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'attendance.shift.create',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'shift',
          targetId: shift.id,
          metadata: { code: shift.code, start: input.start, end: input.end, isDefault: input.isDefault },
        },
        meta,
      );
      return present(shift);
    });
  }

  async update(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateShiftSchema>,
    meta: RequestMeta,
  ) {
    this.requireConfigure(tenant);
    return this.attendance.run(tenant, auth, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('shift-default'))`;
      const before = await tx.shift.findUnique({ where: { id } });
      if (!before) throw new NotFoundError('Shift');
      const archiving = input.status === 'ARCHIVED' && before.status !== 'ARCHIVED';
      if (archiving && (before.isDefault || input.isDefault)) {
        throw new AppError('DEFAULT_SHIFT', 'Make another shift the default before archiving this one', 409);
      }
      if (archiving) {
        const inUse = await this.employeesOn(tx, id);
        if (inUse > 0) {
          throw new AppError(
            'SHIFT_IN_USE',
            `${inUse} current employee${inUse === 1 ? ' is' : 's are'} on this shift. Move them to another shift first.`,
            409,
          );
        }
      }
      if (input.isDefault && !before.isDefault) {
        await tx.shift.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }
      const { code: _code, ...columns } = this.columns({ ...input, code: before.code });
      const shift = await tx.shift.update({
        where: { id },
        data: { ...columns, ...(input.status ? { status: input.status } : {}) },
      });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'attendance.shift.update',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'shift',
          targetId: id,
          metadata: { code: before.code, status: shift.status, start: input.start, end: input.end },
        },
        meta,
      );
      return present(shift);
    });
  }

  private columns(input: ShiftInput) {
    return {
      code: input.code,
      name: input.name,
      startMinute: input.start,
      endMinute: input.end,
      breakMinutes: input.breakMinutes,
      graceMinutes: input.graceMinutes,
      halfDayMinutes: input.halfDayMinutes,
      fullDayMinutes: input.fullDayMinutes,
      weeklyOffs: input.weeklyOffs,
      isDefault: input.isDefault,
    };
  }

  private async employeesOn(tx: Prisma.TransactionClient, shiftId: string): Promise<number> {
    const rows = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM (
        SELECT DISTINCT ON (a.employee_id) a.employee_id, a.shift_id
        FROM shift_assignment a JOIN employee e ON e.id = a.employee_id
        WHERE e.status <> 'EXITED'
        ORDER BY a.employee_id, a.effective_from DESC
      ) latest WHERE latest.shift_id = ${shiftId}::uuid`;
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Puts employees on a shift from a date. Each needs attendance.manage where they sit. Days already
   * worked out since that date (up to two months back) are recomputed under the new shift.
   */
  async assign(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof assignShiftSchema>,
    meta: RequestMeta,
    now = new Date(),
  ) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const shift = await tx.shift.findUnique({ where: { id: input.shiftId } });
      if (!shift || shift.status !== 'ACTIVE') {
        throw new AppError('VALIDATION_FAILED', 'Choose an active shift', 400, [
          { path: 'shiftId', message: 'Choose an active shift' },
        ]);
      }
      const org = await OrgIndex.load(tx, tenant.id);
      const where: Prisma.EmployeeWhereInput = input.employeeIds?.length
        ? { id: { in: input.employeeIds } }
        : input.scope!.type === 'COMPANY'
          ? { companyId: input.scope!.id }
          : input.scope!.type === 'BRANCH'
            ? { branchId: input.scope!.id }
            : { departmentId: input.scope!.id };
      const employees = await tx.employee.findMany({
        where: { AND: [where, { status: { not: 'EXITED' } }] },
        select: ATTENDANCE_EMPLOYEE_SELECT,
      });
      if (input.employeeIds?.length && employees.length !== new Set(input.employeeIds).size) {
        throw new NotFoundError('Employee');
      }
      for (const e of employees) {
        if (!tenant.permissions.allows('attendance.manage', org.scopesOf(e))) throw new ForbiddenError();
      }
      for (const e of employees) {
        await tx.shiftAssignment.upsert({
          where: {
            tenantId_employeeId_effectiveFrom: {
              tenantId: tenant.id,
              employeeId: e.id,
              effectiveFrom: toDate(input.effectiveFrom),
            },
          },
          create: {
            tenantId: tenant.id,
            employeeId: e.id,
            shiftId: shift.id,
            effectiveFrom: toDate(input.effectiveFrom),
            createdByUserId: auth.user.id,
          },
          update: { shiftId: shift.id },
        });
      }
      // Recompute days already worked out under the old shift.
      const book = await ShiftBook.load(
        tx,
        employees.map((e) => e.id),
      );
      let recomputed = 0;
      for (const e of employees) {
        const earliest = addDays(localDate(now, timeZoneOf(e)), -RECOMPUTE_DAYS);
        const from = input.effectiveFrom > earliest ? input.effectiveFrom : earliest;
        const days = await tx.attendanceDay.findMany({
          where: { employeeId: e.id, date: { gte: toDate(from) } },
          select: { date: true },
        });
        for (const d of days) {
          await this.attendance.recompute(tx, e, d.date.toISOString().slice(0, 10), book, now);
          recomputed++;
        }
      }
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'attendance.shift.assign',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'shift',
          targetId: shift.id,
          metadata: {
            effectiveFrom: input.effectiveFrom,
            employees: employees.length,
            ...(input.scope ? { scope: input.scope } : {}),
          },
        },
        meta,
      );
      return { assigned: employees.length, recomputedDays: recomputed };
    });
  }

  /** An employee's shift history, newest first. */
  async history(tenant: TenantContext, auth: AuthContext, employeeId: string) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      await this.attendance.loadFor(tx, tenant, org, employeeId, 'attendance.view');
      const rows = await tx.shiftAssignment.findMany({
        where: { employeeId },
        orderBy: { effectiveFrom: 'desc' },
        include: { shift: { select: { code: true, name: true } } },
      });
      return rows.map((r) => ({
        effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
        shift: r.shift,
        assignedAt: r.createdAt,
      }));
    });
  }
}
