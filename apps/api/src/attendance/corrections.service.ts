import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { ApprovalRequest, Prisma, TenantTransaction } from '@smart-hr/database';
import { AppError, NotFoundError } from '@smart-hr/shared';
import { formatMinutes, type correctionListQuerySchema, type correctionSchema } from '@smart-hr/validation';
import type { z } from 'zod';
import { ApprovalSubjectRegistry } from '../approvals/approval-subjects.js';
import { ApprovalEngine } from '../approvals/approval.engine.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { displayName } from '../employees/employees.service.js';
import { OrgIndex } from '../employees/org-index.js';
import { addDays, localDate, zonedInstant } from './attendance-calc.js';
import {
  ATTENDANCE_EMPLOYEE_SELECT,
  AttendanceService,
  scopeOfEmployee,
  ShiftBook,
  timeZoneOf,
  toDate,
  type AttendanceEmployee,
} from './attendance.service.js';

export const CORRECTION_SUBJECT = 'attendance_regularization';
/** Corrections are for recent days; older ones need HR to record the times directly. */
const MAX_AGE_DAYS = 60;

const iso = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class CorrectionsService implements OnModuleInit {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly engine: ApprovalEngine,
    private readonly subjects: ApprovalSubjectRegistry,
    private readonly audit: AuditService,
  ) {}

  /** Approved corrections become clock-ins; every other outcome only changes the correction's status. */
  onModuleInit(): void {
    const status =
      (to: 'APPROVED' | 'REJECTED' | 'RETURNED' | 'CANCELLED' | 'PENDING') =>
      async (tx: TenantTransaction, request: ApprovalRequest, comment?: string | null) => {
        await tx.attendanceCorrection.update({
          where: { id: request.subjectId },
          data: {
            status: to,
            decisionNote: comment ?? null,
            decidedAt: to === 'PENDING' ? null : new Date(),
          },
        });
      };
    this.subjects.register(CORRECTION_SUBJECT, {
      onApproved: (tx, request) => this.apply(tx, request),
      onRejected: status('REJECTED'),
      onReturned: status('RETURNED'),
      onCancelled: status('CANCELLED'),
      onResubmitted: status('PENDING'),
      link: (request) => `/attendance/corrections/${request.subjectId}`,
    });
  }

  private async apply(tx: TenantTransaction, request: ApprovalRequest) {
    const c = await tx.attendanceCorrection.update({
      where: { id: request.subjectId },
      data: { status: 'APPROVED', decidedAt: new Date() },
    });
    const e = await tx.employee.findUniqueOrThrow({
      where: { id: c.employeeId },
      select: ATTENDANCE_EMPLOYEE_SELECT,
    });
    for (const [at, direction] of [
      [c.inAt, 'IN'],
      [c.outAt, 'OUT'],
    ] as const) {
      if (!at) continue;
      await tx.attendancePunch.create({
        data: {
          tenantId: c.tenantId,
          employeeId: c.employeeId,
          at,
          direction,
          source: 'CORRECTION',
          note: c.reason,
          recordedByUserId: c.requestedByUserId,
          correctionId: c.id,
        },
      });
    }
    await this.attendance.recompute(tx, e, iso(c.date));
  }

  async create(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof correctionSchema>,
    meta: RequestMeta,
    now = new Date(),
  ) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const me = await this.attendance.self(tx, tenant);
      // For someone else, the requester needs attendance.manage where that person sits.
      const e: AttendanceEmployee =
        input.employeeId && input.employeeId !== me?.id
          ? await this.attendance.loadFor(tx, tenant, org, input.employeeId, 'attendance.manage')
          : await this.attendance.requireSelf(tx, tenant);
      const tz = timeZoneOf(e);
      const today = localDate(now, tz);
      const invalid = (path: string, message: string) =>
        new AppError('VALIDATION_FAILED', message, 400, [{ path, message }]);
      if (input.date > today) throw invalid('date', 'You can only correct days that have started');
      if (input.date < addDays(today, -MAX_AGE_DAYS)) {
        throw invalid('date', `Corrections are for the last ${MAX_AGE_DAYS} days. Ask HR about older days.`);
      }
      if (input.date < iso(e.dateOfJoining)) throw invalid('date', 'This is before the joining date');

      const shift = (await ShiftBook.load(tx, [e.id])).on(e.id, input.date);
      // Times are local. A clock-out at or before the clock-in (or before the shift start, for a night shift)
      // is on the next calendar day.
      const inAt = input.in !== undefined ? zonedInstant(input.date, input.in, tz) : null;
      let outAt: Date | null = null;
      if (input.out !== undefined) {
        const reference = input.in ?? shift.startMinute;
        outAt = zonedInstant(input.out <= reference ? addDays(input.date, 1) : input.date, input.out, tz);
      }
      if (inAt && inAt > now) throw invalid('in', 'This time hasn’t happened yet');
      if (outAt && outAt > now) throw invalid('out', 'This time hasn’t happened yet');

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`correction:${e.id}:${input.date}`}))`;
      const open = await tx.attendanceCorrection.findFirst({
        where: { employeeId: e.id, date: toDate(input.date), status: { in: ['PENDING', 'RETURNED'] } },
        select: { id: true },
      });
      if (open) {
        throw new AppError(
          'CORRECTION_OPEN',
          'There is already an open correction for this day. Withdraw it before asking again.',
          409,
        );
      }

      const correction = await tx.attendanceCorrection.create({
        data: {
          tenantId: tenant.id,
          employeeId: e.id,
          date: toDate(input.date),
          inAt,
          outAt,
          reason: input.reason,
          requestedByUserId: auth.user.id,
        },
      });
      const request = await this.engine.submit(
        tx,
        {
          tenantId: tenant.id,
          membershipId: tenant.membershipId,
          userId: auth.user.id,
          displayName: auth.user.displayName,
        },
        {
          subjectType: CORRECTION_SUBJECT,
          subjectId: correction.id,
          title: `Attendance correction: ${displayName(e)}, ${input.date}`,
          scope: scopeOfEmployee(tenant.id, e),
          subjectEmployeeId: e.id,
        },
        meta,
      );
      await tx.attendanceCorrection.update({
        where: { id: correction.id },
        data: { approvalRequestId: request.id },
      });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'attendance.correction.request',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'employee',
          targetId: e.id,
          metadata: {
            correctionId: correction.id,
            date: input.date,
            in: input.in === undefined ? null : formatMinutes(input.in),
            out: input.out === undefined ? null : formatMinutes(input.out),
          },
        },
        meta,
      );
      return this.view(tx, correction.id);
    });
  }

  private async view(tx: TenantTransaction, id: string) {
    const c = await tx.attendanceCorrection.findUniqueOrThrow({
      where: { id },
      include: {
        employee: { select: { ...ATTENDANCE_EMPLOYEE_SELECT } },
      },
    });
    const request = c.approvalRequestId
      ? await tx.approvalRequest.findUnique({
          where: { id: c.approvalRequestId },
          select: { id: true, status: true, currentStage: true },
        })
      : null;
    return {
      id: c.id,
      date: iso(c.date),
      inAt: c.inAt?.toISOString() ?? null,
      outAt: c.outAt?.toISOString() ?? null,
      reason: c.reason,
      status: c.status,
      requestedByUserId: c.requestedByUserId,
      decisionNote: c.decisionNote,
      decidedAt: c.decidedAt,
      createdAt: c.createdAt,
      timeZone: timeZoneOf(c.employee),
      employee: { id: c.employee.id, name: displayName(c.employee), employeeCode: c.employee.employeeCode },
      approvalRequest: request,
    };
  }

  async list(tenant: TenantContext, auth: AuthContext, q: z.output<typeof correctionListQuerySchema>) {
    return this.attendance.run(tenant, auth, async (tx) => {
      let where: Prisma.AttendanceCorrectionWhereInput;
      if (q.scope === 'mine') {
        const me = await this.attendance.self(tx, tenant);
        if (!me) return [];
        where = { employeeId: me.id };
      } else {
        const org = await OrgIndex.load(tx, tenant.id);
        const visible = await this.attendance.visibleWhere(tx, tenant, org);
        if (!visible.any) return [];
        where = visible.where ? { employee: visible.where } : {};
      }
      const rows = await tx.attendanceCorrection.findMany({
        where: { ...where, ...(q.status ? { status: q.status } : {}) },
        orderBy: [{ createdAt: 'desc' }],
        take: 200,
        select: { id: true },
      });
      return Promise.all(rows.map((r) => this.view(tx, r.id)));
    });
  }

  async get(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const c = await tx.attendanceCorrection.findUnique({ where: { id }, select: { employeeId: true } });
      if (!c) throw new NotFoundError('Correction');
      const org = await OrgIndex.load(tx, tenant.id);
      // Approvers assigned to the request may see it even outside their attendance scope.
      const assigned = await tx.approvalTask.count({
        where: {
          request: { subjectType: CORRECTION_SUBJECT, subjectId: id },
          assigneeMembershipId: tenant.membershipId,
        },
      });
      if (!assigned) await this.attendance.loadFor(tx, tenant, org, c.employeeId, 'attendance.view');
      return this.view(tx, id);
    });
  }

  /** Withdraws one's own open correction through the approval engine, which marks it cancelled. */
  async cancel(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const c = await tx.attendanceCorrection.findUnique({ where: { id } });
      if (!c || c.requestedByUserId !== auth.user.id || !c.approvalRequestId)
        throw new NotFoundError('Correction');
      if (c.status !== 'PENDING' && c.status !== 'RETURNED') {
        throw new AppError('CORRECTION_CLOSED', 'Only open corrections can be withdrawn', 409);
      }
      await this.engine.cancel(
        tx,
        {
          tenantId: tenant.id,
          membershipId: tenant.membershipId,
          userId: auth.user.id,
          displayName: auth.user.displayName,
        },
        c.approvalRequestId,
        meta,
      );
      return this.view(tx, id);
    });
  }
}
