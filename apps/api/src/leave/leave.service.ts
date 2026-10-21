import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  isUniqueViolation,
  type ApprovalRequest,
  type Prisma,
  type LeaveType,
  type TenantTransaction,
} from '@smart-hr/database';
import { AppError, defined, ForbiddenError, NotFoundError } from '@smart-hr/shared';
import type {
  allocationSchema,
  balanceAdjustmentSchema,
  balanceQuerySchema,
  createLeaveTypeSchema,
  leaveCalendarQuerySchema,
  leaveListQuerySchema,
  leavePreviewSchema,
  leaveRequestSchema,
  updateLeaveTypeSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { ApprovalSubjectRegistry } from '../approvals/approval-subjects.js';
import { ApprovalEngine } from '../approvals/approval.engine.js';
import { WebhookEventsService } from '../integrations/webhook-events.service.js';
import { AuditService } from '../audit/audit.service.js';
import { addDays, localDate } from '../attendance/attendance-calc.js';
import {
  ATTENDANCE_EMPLOYEE_SELECT,
  AttendanceService,
  scopeOfEmployee,
  ShiftBook,
  timeZoneOf,
  toDate,
  type AttendanceEmployee,
} from '../attendance/attendance.service.js';
import { DayMarks } from '../attendance/day-marks.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { displayName } from '../employees/employees.service.js';
import { OrgIndex } from '../employees/org-index.js';
import { carryForward, countLeaveDays, monthlyAccruals, yearlyGrant } from './leave-calc.js';

export const LEAVE_SUBJECT = 'leave_request';
/** Leave for oneself can be recorded afterwards (sick leave), but not for long-past days. */
const MAX_BACKDATE_DAYS = 60;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | number) => Number(d);
const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

function invalid(path: string, message: string) {
  return new AppError('VALIDATION_FAILED', message, 400, [{ path, message }]);
}

export interface BalanceView {
  leaveType: { id: string; code: string; name: string; paid: boolean; accrual: LeaveType['accrual'] };
  year: number;
  /** Credited this year: grant or monthly accruals so far. */
  credited: number;
  carriedForward: number;
  adjusted: number;
  /** Taken, net of reversals. */
  taken: number;
  lapsed: number;
  /** Credited + carried + adjusted − taken − lapsed. */
  balance: number;
  /** Waiting for approval. */
  pending: number;
  /** Balance − pending: what a new request can use. */
  available: number;
}

/**
 * Leave: types, balances kept as an append-only ledger, and requests that go through the approval engine.
 * Yearly grants, monthly accruals and carry-forward are credited automatically and idempotently the first
 * time a balance is needed (each credit has a unique period key), so no scheduled job is required.
 */
@Injectable()
export class LeaveService implements OnModuleInit {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly engine: ApprovalEngine,
    private readonly subjects: ApprovalSubjectRegistry,
    private readonly audit: AuditService,
    private readonly webhooks: WebhookEventsService,
  ) {}

  onModuleInit(): void {
    const status =
      (to: 'REJECTED' | 'RETURNED' | 'CANCELLED' | 'PENDING') =>
      async (tx: TenantTransaction, request: ApprovalRequest, comment?: string | null) => {
        await tx.leaveRequest.update({
          where: { id: request.subjectId },
          data: {
            status: to,
            decisionNote: comment ?? null,
            decidedAt: to === 'PENDING' ? null : new Date(),
          },
        });
      };
    this.subjects.register(LEAVE_SUBJECT, {
      onApproved: (tx, request) => this.applyApproval(tx, request),
      onRejected: status('REJECTED'),
      onReturned: status('RETURNED'),
      onCancelled: status('CANCELLED'),
      onResubmitted: status('PENDING'),
      link: (request) => `/leave/requests/${request.subjectId}`,
    });
  }

  run<T>(tenant: TenantContext, auth: AuthContext, work: (tx: TenantTransaction) => Promise<T>) {
    return this.attendance.run(tenant, auth, work);
  }

  // ---- Leave types ---------------------------------------------------------------------------------

  private typeView(t: LeaveType) {
    return {
      id: t.id,
      code: t.code,
      name: t.name,
      description: t.description,
      paid: t.paid,
      accrual: t.accrual,
      quotaDays: num(t.quotaDays),
      carryForwardMaxDays: num(t.carryForwardMaxDays),
      allowHalfDay: t.allowHalfDay,
      includeNonWorkingDays: t.includeNonWorkingDays,
      minNoticeDays: t.minNoticeDays,
      maxDaysPerRequest: t.maxDaysPerRequest,
      status: t.status,
    };
  }

  async listTypes(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const rows = await tx.leaveType.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }] });
      return rows.map((t) => this.typeView(t));
    });
  }

  private assertConfigure(tenant: TenantContext) {
    // Leave types apply to the whole organisation.
    if (!tenant.permissions.allowsTenantWide('leave.configure')) throw new ForbiddenError();
  }

  async createType(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof createLeaveTypeSchema>,
    meta: RequestMeta,
  ) {
    this.assertConfigure(tenant);
    return this.run(tenant, auth, async (tx) => {
      let created;
      try {
        created = await tx.leaveType.create({
          data: { tenantId: tenant.id, ...input, description: input.description ?? null },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError('CODE_TAKEN', 'Another leave type uses this code', 409, [
            { path: 'code', message: 'Already in use' },
          ]);
        }
        throw error;
      }
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'leave.type.create',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'leave_type',
          targetId: created.id,
          metadata: { code: created.code, accrual: created.accrual, quotaDays: input.quotaDays },
        },
        meta,
      );
      return this.typeView(created);
    });
  }

  async updateType(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateLeaveTypeSchema>,
    meta: RequestMeta,
  ) {
    this.assertConfigure(tenant);
    return this.run(tenant, auth, async (tx) => {
      const existing = await tx.leaveType.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError('Leave type');
      const updated = await tx.leaveType.update({ where: { id }, data: defined(input) });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'leave.type.update',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'leave_type',
          targetId: id,
          metadata: { code: existing.code, ...input },
        },
        meta,
      );
      return this.typeView(updated);
    });
  }

  // ---- Who ---------------------------------------------------------------------------------------

  /** The employee a request is for: myself, or someone where I hold leave.manage. */
  private async subjectOf(
    tx: TenantTransaction,
    tenant: TenantContext,
    employeeId: string | undefined,
  ): Promise<{ e: AttendanceEmployee; self: boolean }> {
    const me = await this.attendance.self(tx, tenant);
    if (employeeId && employeeId !== me?.id) {
      const org = await OrgIndex.load(tx, tenant.id);
      const e = await this.attendance.loadFor(tx, tenant, org, employeeId, 'leave.manage', 'leave.view');
      return { e, self: false };
    }
    return { e: await this.attendance.requireSelf(tx, tenant), self: true };
  }

  // ---- Balances ----------------------------------------------------------------------------------

  /**
   * Credits whatever is due for a year and hasn't been credited yet: last year's remaining credits, then
   * last year's carry-forward (with the rest lapsing), then this year's yearly grant or monthly accruals up
   * to the current month. Safe to call any number of times, concurrently too: every automatic entry has a
   * unique period key.
   */
  async ensureCredits(tx: TenantTransaction, e: AttendanceEmployee, year: number, now = new Date()) {
    const today = localDate(now, timeZoneOf(e));
    if (year > Number(today.slice(0, 4))) return;
    const types = await tx.leaveType.findMany({ where: { status: 'ACTIVE', accrual: { not: 'NONE' } } });
    if (!types.length) return;
    await this.creditYear(tx, e, types, year - 1, today);
    await this.carryInto(tx, e, types, year, today);
    await this.creditYear(tx, e, types, year, today);
  }

  private employment(e: AttendanceEmployee) {
    const joinedOn = iso(e.dateOfJoining);
    const leftOn = e.exitedOn
      ? iso(e.exitedOn)
      : e.status === 'EXITED' && e.lastWorkingDay
        ? iso(e.lastWorkingDay)
        : null;
    return { joinedOn, leftOn };
  }

  /** The yearly grant or the monthly accruals due so far for one year. */
  private async creditYear(
    tx: TenantTransaction,
    e: AttendanceEmployee,
    types: LeaveType[],
    year: number,
    today: string,
  ) {
    const { joinedOn, leftOn } = this.employment(e);
    if (joinedOn > `${year}-12-31` || joinedOn > today) return;
    if (leftOn && leftOn < `${year}-01-01`) return;
    const currentYear = Number(today.slice(0, 4));
    const base = { tenantId: e.tenantId, employeeId: e.id, year };
    const rows: Prisma.LeaveLedgerEntryCreateManyInput[] = [];
    for (const t of types) {
      const quota = num(t.quotaDays);
      if (t.accrual === 'YEARLY') {
        const days = yearlyGrant(quota, year, joinedOn);
        if (days > 0)
          rows.push({
            ...base,
            leaveTypeId: t.id,
            kind: 'GRANT',
            days,
            periodKey: `${year}`,
            note: 'Yearly grant',
          });
      } else {
        const throughMonth = year < currentYear ? 12 : Number(today.slice(5, 7));
        for (const c of monthlyAccruals({ quota, year, throughMonth, joinedOn, leftOn })) {
          rows.push({
            ...base,
            leaveTypeId: t.id,
            kind: 'ACCRUAL',
            days: c.days,
            periodKey: c.periodKey,
            note: 'Monthly accrual',
          });
        }
      }
    }
    if (rows.length) await tx.leaveLedgerEntry.createMany({ data: rows, skipDuplicates: true });
  }

  /** Moves last year's unused days into `year`, up to each type's limit; the rest lapse in last year. */
  private async carryInto(
    tx: TenantTransaction,
    e: AttendanceEmployee,
    types: LeaveType[],
    year: number,
    today: string,
  ) {
    const { joinedOn } = this.employment(e);
    if (joinedOn >= `${year}-01-01` || today < `${year}-01-01`) return;
    const previous = year - 1;
    const base = { tenantId: e.tenantId, employeeId: e.id };
    for (const t of types) {
      const done = await tx.leaveLedgerEntry.count({
        where: {
          employeeId: e.id,
          leaveTypeId: t.id,
          kind: { in: ['CARRY_FORWARD', 'LAPSE'] },
          periodKey: `${year}`,
        },
      });
      if (done) continue;
      const last = await tx.leaveLedgerEntry.aggregate({
        where: { employeeId: e.id, leaveTypeId: t.id, year: previous },
        _sum: { days: true },
      });
      const { carry, lapse } = carryForward(num(last._sum.days ?? 0), num(t.carryForwardMaxDays));
      const entries: Prisma.LeaveLedgerEntryCreateManyInput[] = [];
      if (carry > 0) {
        entries.push({
          ...base,
          leaveTypeId: t.id,
          year,
          kind: 'CARRY_FORWARD',
          days: carry,
          periodKey: `${year}`,
          note: `Carried forward from ${previous}`,
        });
      }
      if (lapse > 0) {
        entries.push({
          ...base,
          leaveTypeId: t.id,
          year: previous,
          kind: 'LAPSE',
          days: -lapse,
          periodKey: `${year}`,
          note: `Lapsed at the end of ${previous}`,
        });
      }
      if (entries.length) await tx.leaveLedgerEntry.createMany({ data: entries, skipDuplicates: true });
    }
  }

  /** Balances for one employee and year, for every active leave type that keeps a balance. */
  async balancesOf(
    tx: TenantTransaction,
    e: AttendanceEmployee,
    year: number,
    now = new Date(),
  ): Promise<BalanceView[]> {
    await this.ensureCredits(tx, e, year, now);
    const types = await tx.leaveType.findMany({
      where: { status: 'ACTIVE', accrual: { not: 'NONE' } },
      orderBy: { name: 'asc' },
    });
    const entries = await tx.leaveLedgerEntry.groupBy({
      by: ['leaveTypeId', 'kind'],
      where: { employeeId: e.id, year },
      _sum: { days: true },
    });
    const pending = await tx.leaveRequest.groupBy({
      by: ['leaveTypeId'],
      where: {
        employeeId: e.id,
        status: { in: ['PENDING', 'RETURNED'] },
        fromDate: { gte: toDate(`${year}-01-01`), lte: toDate(`${year}-12-31`) },
      },
      _sum: { days: true },
    });
    return types.map((t) => {
      const sum = (kinds: string[]) =>
        entries
          .filter((r) => r.leaveTypeId === t.id && kinds.includes(r.kind))
          .reduce((n, r) => n + num(r._sum.days ?? 0), 0);
      const credited = sum(['GRANT', 'ACCRUAL']);
      const carriedForward = sum(['CARRY_FORWARD']);
      const adjusted = sum(['ADJUSTMENT']);
      const taken = -sum(['TAKEN', 'REVERSAL']);
      const lapsed = -sum(['LAPSE']);
      const balance = credited + carriedForward + adjusted - taken - lapsed;
      const waiting = num(pending.find((p) => p.leaveTypeId === t.id)?._sum.days ?? 0);
      return {
        leaveType: { id: t.id, code: t.code, name: t.name, paid: t.paid, accrual: t.accrual },
        year,
        credited,
        carriedForward,
        adjusted,
        taken,
        lapsed,
        balance,
        pending: waiting,
        available: balance - waiting,
      };
    });
  }

  async myBalances(tenant: TenantContext, auth: AuthContext, year: number) {
    return this.run(tenant, auth, async (tx) => {
      const me = await this.attendance.self(tx, tenant);
      if (!me) return { employee: null, balances: [] };
      return {
        employee: { id: me.id, name: displayName(me), employeeCode: me.employeeCode },
        balances: await this.balancesOf(tx, me, year),
      };
    });
  }

  /** One employee's balances and ledger: themself, their manager line, or leave.view where they sit. */
  async employeeBalances(tenant: TenantContext, auth: AuthContext, employeeId: string, year: number) {
    return this.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const e = await this.attendance.loadFor(tx, tenant, org, employeeId, 'leave.view', 'leave.view');
      const balances = await this.balancesOf(tx, e, year);
      const ledger = await tx.leaveLedgerEntry.findMany({
        where: { employeeId, year },
        orderBy: [{ createdAt: 'asc' }],
        include: { leaveType: { select: { name: true } } },
      });
      return {
        employee: { id: e.id, name: displayName(e), employeeCode: e.employeeCode },
        balances,
        ledger: ledger.map((l) => ({
          id: l.id,
          leaveType: l.leaveType.name,
          kind: l.kind,
          days: num(l.days),
          note: l.note,
          requestId: l.requestId,
          createdAt: l.createdAt,
        })),
        canAdjust:
          e.membershipId !== tenant.membershipId &&
          tenant.permissions.allows('leave.manage', org.scopesOf(e)),
      };
    });
  }

  /** Balances for everyone the member can see, one page at a time. */
  async balances(tenant: TenantContext, auth: AuthContext, q: z.output<typeof balanceQuerySchema>) {
    return this.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const visible = await this.attendance.visibleWhere(tx, tenant, org, 'leave.view');
      if (!visible.any) return { total: 0, page: q.page, pageSize: q.pageSize, types: [], rows: [] };
      const terms = (q.search ?? '').split(/\s+/).filter(Boolean);
      const where: Prisma.EmployeeWhereInput = {
        AND: [
          visible.where ?? {},
          { status: { not: 'EXITED' } },
          ...terms.map((term) => ({
            OR: [
              { firstName: { contains: term, mode: 'insensitive' as const } },
              { lastName: { contains: term, mode: 'insensitive' as const } },
              { employeeCode: { contains: term, mode: 'insensitive' as const } },
            ],
          })),
        ],
      };
      const total = await tx.employee.count({ where });
      const employees = await tx.employee.findMany({
        where,
        orderBy: { employeeCode: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: ATTENDANCE_EMPLOYEE_SELECT,
      });
      const rows = [];
      for (const e of employees) {
        const balances = await this.balancesOf(tx, e, q.year);
        rows.push({
          employee: {
            id: e.id,
            name: displayName(e),
            employeeCode: e.employeeCode,
            department: e.department?.name ?? null,
          },
          balances: balances.map((b) => ({
            leaveTypeId: b.leaveType.id,
            balance: b.balance,
            available: b.available,
          })),
        });
      }
      const types = await tx.leaveType.findMany({
        where: { status: 'ACTIVE', accrual: { not: 'NONE' } },
        orderBy: { name: 'asc' },
        select: { id: true, code: true, name: true },
      });
      return { total, page: q.page, pageSize: q.pageSize, types, rows };
    });
  }

  async adjust(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof balanceAdjustmentSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const e = await this.attendance.loadFor(
        tx,
        tenant,
        org,
        input.employeeId,
        'leave.manage',
        'leave.view',
      );
      if (e.membershipId === tenant.membershipId) {
        throw new AppError('SEPARATION_OF_DUTIES', 'You can’t adjust your own leave balance', 403);
      }
      const type = await tx.leaveType.findUnique({ where: { id: input.leaveTypeId } });
      if (!type || type.accrual === 'NONE')
        throw invalid('leaveTypeId', 'Choose a leave type that keeps a balance');
      const entry = await tx.leaveLedgerEntry.create({
        data: {
          tenantId: tenant.id,
          employeeId: e.id,
          leaveTypeId: type.id,
          year: input.year,
          kind: 'ADJUSTMENT',
          days: input.days,
          note: input.note,
          createdByUserId: auth.user.id,
        },
      });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'leave.balance.adjust',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'employee',
          targetId: e.id,
          metadata: { leaveType: type.code, year: input.year, days: input.days, note: input.note },
        },
        meta,
      );
      return { id: entry.id, balances: await this.balancesOf(tx, e, input.year) };
    });
  }

  /** Credits what is due for a year to every current employee (HR's "bring balances up to date"). */
  async allocate(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof allocationSchema>,
    meta: RequestMeta,
  ) {
    if (!tenant.permissions.allowsTenantWide('leave.manage')) throw new ForbiddenError();
    return this.run(tenant, auth, async (tx) => {
      const before = await tx.leaveLedgerEntry.count({
        where: { year: { in: [input.year, input.year - 1] } },
      });
      const employees = await tx.employee.findMany({
        where: { status: { not: 'EXITED' } },
        select: ATTENDANCE_EMPLOYEE_SELECT,
      });
      for (const e of employees) await this.ensureCredits(tx, e, input.year);
      const after = await tx.leaveLedgerEntry.count({
        where: { year: { in: [input.year, input.year - 1] } },
      });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'leave.allocate',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          metadata: { year: input.year, employees: employees.length, entries: after - before },
        },
        meta,
      );
      return { employees: employees.length, entries: after - before };
    });
  }

  // ---- Requests ----------------------------------------------------------------------------------

  /** Works out the days a request would use, and checks it against the rules. Shared by preview and create. */
  private async evaluate(
    tx: TenantTransaction,
    e: AttendanceEmployee,
    self: boolean,
    input: {
      leaveTypeId: string;
      from: string;
      to: string;
      halfDay?: 'FIRST_HALF' | 'SECOND_HALF' | null | undefined;
    },
    now = new Date(),
  ) {
    const type = await tx.leaveType.findUnique({ where: { id: input.leaveTypeId } });
    if (!type || type.status !== 'ACTIVE') throw invalid('leaveTypeId', 'Choose an active leave type');
    if (input.halfDay && !type.allowHalfDay)
      throw invalid('halfDay', `${type.name} can’t be taken as half days`);
    const today = localDate(now, timeZoneOf(e));
    const joinedOn = iso(e.dateOfJoining);
    if (input.from < joinedOn) throw invalid('from', 'This is before the joining date');
    const lastDay = e.lastWorkingDay ? iso(e.lastWorkingDay) : null;
    if (lastDay && input.to > lastDay) throw invalid('to', `This is after the last working day (${lastDay})`);
    if (self) {
      if (input.from < addDays(today, -MAX_BACKDATE_DAYS)) {
        throw invalid(
          'from',
          `Leave can be recorded up to ${MAX_BACKDATE_DAYS} days afterwards. Ask HR about older days.`,
        );
      }
      if (type.minNoticeDays > 0 && input.from < addDays(today, type.minNoticeDays)) {
        throw invalid('from', `${type.name} needs ${plural(type.minNoticeDays)}’ notice`);
      }
    }

    const book = await ShiftBook.load(tx, [e.id]);
    const marks = await DayMarks.load(tx, [e], input.from, input.to);
    const { days, dates } = countLeaveDays({
      from: input.from,
      to: input.to,
      halfDay: input.halfDay ?? null,
      includeNonWorkingDays: type.includeNonWorkingDays,
      isNonWorking: (date) =>
        book.on(e.id, date).weeklyOffs.includes(new Date(`${date}T00:00:00Z`).getUTCDay()) ||
        !!marks.holiday(e.id, date),
    });
    if (days === 0) throw invalid('to', 'These dates are all weekly offs or holidays, so no leave is needed');
    if (type.maxDaysPerRequest && days > type.maxDaysPerRequest) {
      throw invalid('to', `${type.name} can be at most ${plural(type.maxDaysPerRequest)} at a time`);
    }

    const year = Number(input.from.slice(0, 4));
    let balance: BalanceView | null = null;
    if (type.accrual !== 'NONE') {
      balance = (await this.balancesOf(tx, e, year, now)).find((b) => b.leaveType.id === type.id) ?? null;
    }
    return { type, days, dates, year, balance };
  }

  async preview(tenant: TenantContext, auth: AuthContext, input: z.output<typeof leavePreviewSchema>) {
    return this.run(tenant, auth, async (tx) => {
      const { e, self } = await this.subjectOf(tx, tenant, input.employeeId);
      const r = await this.evaluate(tx, e, self, input);
      return {
        days: r.days,
        dates: r.dates,
        available: r.balance?.available ?? null,
        afterwards: r.balance ? r.balance.available - r.days : null,
      };
    });
  }

  async create(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof leaveRequestSchema>,
    meta: RequestMeta,
    now = new Date(),
  ) {
    return this.run(tenant, auth, async (tx) => {
      const { e, self } = await this.subjectOf(tx, tenant, input.employeeId);
      // One request at a time per employee, so two can't both pass the balance and overlap checks.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`leave:${e.id}`}))`;
      const r = await this.evaluate(tx, e, self, input, now);

      const overlap = await tx.leaveRequest.findFirst({
        where: {
          employeeId: e.id,
          status: { in: ['PENDING', 'RETURNED', 'APPROVED'] },
          fromDate: { lte: toDate(input.to) },
          toDate: { gte: toDate(input.from) },
        },
        select: { fromDate: true, toDate: true },
      });
      if (overlap) {
        throw new AppError(
          'LEAVE_OVERLAP',
          `This overlaps leave already requested for ${iso(overlap.fromDate)}${
            iso(overlap.toDate) !== iso(overlap.fromDate) ? ` to ${iso(overlap.toDate)}` : ''
          }`,
          409,
        );
      }
      if (r.balance && r.days > r.balance.available) {
        throw new AppError(
          'INSUFFICIENT_BALANCE',
          `Not enough ${r.type.name}: ${plural(r.balance.available)} available, ${plural(r.days)} requested`,
          409,
          [{ path: 'leaveTypeId', message: `${plural(r.balance.available)} available` }],
        );
      }

      const request = await tx.leaveRequest.create({
        data: {
          tenantId: tenant.id,
          employeeId: e.id,
          leaveTypeId: r.type.id,
          fromDate: toDate(input.from),
          toDate: toDate(input.to),
          halfDay: input.halfDay ?? null,
          days: r.days,
          reason: input.reason,
          requestedByUserId: auth.user.id,
        },
      });
      const when = input.from === input.to ? input.from : `${input.from} to ${input.to}`;
      const approval = await this.engine.submit(
        tx,
        {
          tenantId: tenant.id,
          membershipId: tenant.membershipId,
          userId: auth.user.id,
          displayName: auth.user.displayName,
        },
        {
          subjectType: LEAVE_SUBJECT,
          subjectId: request.id,
          title: `${r.type.name}: ${displayName(e)}, ${when} (${plural(r.days)})`,
          scope: scopeOfEmployee(tenant.id, e),
          subjectEmployeeId: e.id,
        },
        meta,
      );
      await tx.leaveRequest.update({ where: { id: request.id }, data: { approvalRequestId: approval.id } });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'leave.request',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'employee',
          targetId: e.id,
          metadata: {
            requestId: request.id,
            leaveType: r.type.code,
            from: input.from,
            to: input.to,
            days: r.days,
            onBehalf: !self,
          },
        },
        meta,
      );
      return this.view(tx, tenant, auth, request.id);
    });
  }

  /** Approval: the days come off the balance and attendance already worked out for those days is redone. */
  private async applyApproval(tx: TenantTransaction, request: ApprovalRequest) {
    const leave = await tx.leaveRequest.update({
      where: { id: request.subjectId },
      data: { status: 'APPROVED', decidedAt: new Date() },
      include: { leaveType: true },
    });
    if (leave.leaveType.accrual !== 'NONE') {
      await tx.leaveLedgerEntry.create({
        data: {
          tenantId: leave.tenantId,
          employeeId: leave.employeeId,
          leaveTypeId: leave.leaveTypeId,
          year: leave.fromDate.getUTCFullYear(),
          kind: 'TAKEN',
          days: -num(leave.days),
          requestId: leave.id,
          note: 'Approved leave',
        },
      });
    }
    await this.recomputeDays(tx, leave.employeeId, iso(leave.fromDate), iso(leave.toDate));
    await this.webhooks.emit(tx, leave.tenantId, 'leave.request.approved', {
      requestId: leave.id,
      employeeId: leave.employeeId,
      leaveType: leave.leaveType.code,
      from: iso(leave.fromDate),
      to: iso(leave.toDate),
      days: num(leave.days),
    });
  }

  private async recomputeDays(tx: TenantTransaction, employeeId: string, from: string, to: string) {
    const e = await tx.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: ATTENDANCE_EMPLOYEE_SELECT,
    });
    const today = localDate(new Date(), timeZoneOf(e));
    const last = to < today ? to : today;
    for (let d = from; d <= last; d = addDays(d, 1)) await this.attendance.recompute(tx, e, d);
  }

  /**
   * Withdraws a request. Open requests are withdrawn through the approval engine by whoever made them. An
   * approved request can be cancelled by the employee before it starts, or by someone with leave.manage
   * where the employee sits at any time; the days go back on the balance.
   */
  async cancel(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    reason: string | null | undefined,
    meta: RequestMeta,
    now = new Date(),
  ) {
    return this.run(tenant, auth, async (tx) => {
      const leave = await tx.leaveRequest.findUnique({ where: { id }, include: { leaveType: true } });
      if (!leave) throw new NotFoundError('Leave request');
      const actor = {
        tenantId: tenant.id,
        membershipId: tenant.membershipId,
        userId: auth.user.id,
        displayName: auth.user.displayName,
      };

      if (leave.status === 'PENDING' || leave.status === 'RETURNED') {
        if (leave.requestedByUserId !== auth.user.id || !leave.approvalRequestId)
          throw new NotFoundError('Leave request');
        await this.engine.cancel(tx, actor, leave.approvalRequestId, meta);
        return this.view(tx, tenant, auth, id);
      }
      if (leave.status !== 'APPROVED') {
        throw new AppError('LEAVE_CLOSED', 'Only open or approved leave can be cancelled', 409);
      }

      const org = await OrgIndex.load(tx, tenant.id);
      const e = await this.attendance.loadFor(tx, tenant, org, leave.employeeId, 'leave.view', 'leave.view');
      const mine = e.membershipId === tenant.membershipId;
      const canManage = !mine && tenant.permissions.allows('leave.manage', org.scopesOf(e));
      const today = localDate(now, timeZoneOf(e));
      if (!canManage) {
        if (!mine) throw new ForbiddenError();
        if (iso(leave.fromDate) <= today) {
          throw new AppError('LEAVE_STARTED', 'This leave has started. Ask HR to change it.', 409);
        }
      }
      await tx.leaveRequest.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledByUserId: auth.user.id,
          cancelledAt: now,
          decisionNote: reason ?? null,
        },
      });
      if (leave.leaveType.accrual !== 'NONE') {
        await tx.leaveLedgerEntry.create({
          data: {
            tenantId: tenant.id,
            employeeId: leave.employeeId,
            leaveTypeId: leave.leaveTypeId,
            year: leave.fromDate.getUTCFullYear(),
            kind: 'REVERSAL',
            days: num(leave.days),
            requestId: leave.id,
            note: reason ? `Cancelled: ${reason}` : 'Cancelled',
            createdByUserId: auth.user.id,
          },
        });
      }
      await this.recomputeDays(tx, leave.employeeId, iso(leave.fromDate), iso(leave.toDate));
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'leave.cancel',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'employee',
          targetId: leave.employeeId,
          metadata: { requestId: id, days: num(leave.days), reason: reason ?? null, byManager: canManage },
        },
        meta,
      );
      return this.view(tx, tenant, auth, id);
    });
  }

  private async view(
    tx: TenantTransaction,
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    org?: OrgIndex,
  ) {
    const r = await tx.leaveRequest.findUniqueOrThrow({
      where: { id },
      include: { employee: { select: ATTENDANCE_EMPLOYEE_SELECT }, leaveType: true },
    });
    const approval = r.approvalRequestId
      ? await tx.approvalRequest.findUnique({
          where: { id: r.approvalRequestId },
          select: { id: true, status: true, currentStage: true },
        })
      : null;
    const mine = r.employee.membershipId === tenant.membershipId;
    const today = localDate(new Date(), timeZoneOf(r.employee));
    let canCancel = false;
    if (r.status === 'PENDING' || r.status === 'RETURNED') canCancel = r.requestedByUserId === auth.user.id;
    else if (r.status === 'APPROVED') {
      const index = org ?? (await OrgIndex.load(tx, tenant.id));
      canCancel =
        (mine && iso(r.fromDate) > today) ||
        (!mine && tenant.permissions.allows('leave.manage', index.scopesOf(r.employee)));
    }
    return {
      id: r.id,
      employee: { id: r.employee.id, name: displayName(r.employee), employeeCode: r.employee.employeeCode },
      leaveType: {
        id: r.leaveType.id,
        code: r.leaveType.code,
        name: r.leaveType.name,
        paid: r.leaveType.paid,
      },
      from: iso(r.fromDate),
      to: iso(r.toDate),
      halfDay: r.halfDay,
      days: num(r.days),
      reason: r.reason,
      status: r.status,
      decisionNote: r.decisionNote,
      decidedAt: r.decidedAt,
      cancelledAt: r.cancelledAt,
      createdAt: r.createdAt,
      requestedByUserId: r.requestedByUserId,
      approvalRequest: approval,
      canCancel,
    };
  }

  async get(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, async (tx) => {
      const r = await tx.leaveRequest.findUnique({ where: { id }, select: { employeeId: true } });
      if (!r) throw new NotFoundError('Leave request');
      const assigned = await tx.approvalTask.count({
        where: {
          request: { subjectType: LEAVE_SUBJECT, subjectId: id },
          assigneeMembershipId: tenant.membershipId,
        },
      });
      if (!assigned) {
        const org = await OrgIndex.load(tx, tenant.id);
        await this.attendance.loadFor(tx, tenant, org, r.employeeId, 'leave.view', 'leave.view');
      }
      return this.view(tx, tenant, auth, id);
    });
  }

  async list(tenant: TenantContext, auth: AuthContext, q: z.output<typeof leaveListQuerySchema>) {
    return this.run(tenant, auth, async (tx) => {
      let where: Prisma.LeaveRequestWhereInput;
      const org = await OrgIndex.load(tx, tenant.id);
      if (q.scope === 'mine') {
        const me = await this.attendance.self(tx, tenant);
        if (!me) return [];
        where = { employeeId: me.id };
      } else {
        const visible = await this.attendance.visibleWhere(tx, tenant, org, 'leave.view');
        if (!visible.any) return [];
        where = visible.where ? { employee: visible.where } : {};
      }
      const rows = await tx.leaveRequest.findMany({
        where: {
          ...where,
          ...(q.status ? { status: q.status } : {}),
          ...(q.from ? { toDate: { gte: toDate(q.from) } } : {}),
          ...(q.to ? { fromDate: { lte: toDate(q.to) } } : {}),
        },
        orderBy: [{ fromDate: 'desc' }],
        take: 300,
        select: { id: true },
      });
      const views = [];
      for (const r of rows) views.push(await this.view(tx, tenant, auth, r.id, org));
      return views;
    });
  }

  /** Who is away when: approved and pending leave for the people I can see, plus holidays. */
  async calendar(tenant: TenantContext, auth: AuthContext, q: z.output<typeof leaveCalendarQuerySchema>) {
    if (q.to < q.from || addDays(q.from, 62) < q.to) {
      throw invalid('to', 'Choose up to two months');
    }
    return this.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const visible = await this.attendance.visibleWhere(tx, tenant, org, 'leave.view');
      const me = await this.attendance.self(tx, tenant);
      const people: Prisma.EmployeeWhereInput[] = [];
      if (visible.any) people.push(visible.where ?? {});
      if (me) people.push({ id: me.id });
      if (!people.length) return { from: q.from, to: q.to, entries: [] };
      const rows = await tx.leaveRequest.findMany({
        where: {
          employee: {
            OR: people,
            ...(q.companyId ? { companyId: q.companyId } : {}),
            ...(q.departmentId ? { departmentId: q.departmentId } : {}),
          },
          status: { in: ['PENDING', 'APPROVED'] },
          fromDate: { lte: toDate(q.to) },
          toDate: { gte: toDate(q.from) },
        },
        orderBy: [{ fromDate: 'asc' }],
        take: 1000,
        include: {
          employee: {
            select: { id: true, firstName: true, lastName: true, preferredName: true, employeeCode: true },
          },
          leaveType: { select: { name: true } },
        },
      });
      return {
        from: q.from,
        to: q.to,
        entries: rows.map((r) => ({
          id: r.id,
          employee: {
            id: r.employee.id,
            name: displayName(r.employee),
            employeeCode: r.employee.employeeCode,
          },
          leaveType: r.leaveType.name,
          from: iso(r.fromDate),
          to: iso(r.toDate),
          halfDay: r.halfDay,
          status: r.status,
        })),
      };
    });
  }
}
