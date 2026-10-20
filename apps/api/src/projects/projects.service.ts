import { Injectable } from '@nestjs/common';
import { isUniqueViolation, type Prisma, type TenantTransaction } from '@smart-hr/database';
import { AppError, ForbiddenError, NotFoundError, type ScopeRef } from '@smart-hr/shared';
import type {
  approveTimeSchema,
  projectListQuerySchema,
  projectMembersSchema,
  projectSchema,
  timeEntrySchema,
  timeRangeSchema,
  updateProjectSchema,
  updateTimeEntrySchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { AttendanceService, toDate } from '../attendance/attendance.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { displayName } from '../employees/employees.service.js';

const num = (d: Prisma.Decimal | number | null) => (d === null ? null : Number(d));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const paise = (n: number) => Math.round(n * 100);

const companyScopes = (tenantId: string, companyId: string): ScopeRef[] => [
  { type: 'TENANT', id: tenantId },
  { type: 'COMPANY', id: companyId },
];

function invalid(path: string, message: string) {
  return new AppError('VALIDATION_FAILED', message, 400, [{ path, message }]);
}

/** The database refuses a day over 24 hours and any change to approved time; say so in plain words. */
function timeError(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('more than 24 hours')) {
    throw new AppError('DAY_TOO_LONG', 'That would make more than 24 hours on one day', 409);
  }
  if (message.includes('approved time')) {
    throw new AppError('TIME_APPROVED', 'Approved time can’t be changed', 409);
  }
  throw error;
}

type ProjectRow = Prisma.ProjectGetPayload<object>;
type EntryRow = Prisma.TimeEntryGetPayload<object>;

/**
 * Projects and timesheets: people on a project log hours against it, the project manager approves them, and
 * the project shows hours against budget and what it earned against what the time cost. Money is worked out
 * in whole paise from minutes so the totals add up exactly.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly audit: AuditService,
  ) {}

  private run<T>(tenant: TenantContext, auth: AuthContext, work: (tx: TenantTransaction) => Promise<T>) {
    return this.attendance.run(tenant, auth, work);
  }

  private record(
    tx: TenantTransaction,
    tenant: TenantContext,
    auth: AuthContext,
    action: string,
    targetType: string,
    targetId: string,
    meta: RequestMeta,
    metadata: Record<string, string | number> = {},
  ) {
    return this.audit.recordInTransaction(
      tx,
      {
        action,
        outcome: 'SUCCESS',
        tenantId: tenant.id,
        actorUserId: auth.user.id,
        targetType,
        targetId,
        metadata,
      },
      meta,
    );
  }

  private canManage(tenant: TenantContext, companyId: string) {
    return tenant.permissions.allows('projects.manage', companyScopes(tenant.id, companyId));
  }

  private canView(tenant: TenantContext, companyId: string) {
    return (
      this.canManage(tenant, companyId) ||
      tenant.permissions.allows('projects.view', companyScopes(tenant.id, companyId))
    );
  }

  private async selfId(tx: TenantTransaction, tenant: TenantContext) {
    return (await this.attendance.self(tx, tenant))?.id ?? null;
  }

  // ---- Projects ----------------------------------------------------------------------------------

  private async totals(tx: TenantTransaction, projectIds: string[]) {
    const rows = await tx.timeEntry.groupBy({
      by: ['projectId', 'status', 'billable'],
      where: { projectId: { in: projectIds } },
      _sum: { minutes: true },
    });
    const out = new Map<string, { minutes: number; approved: number; billable: number }>();
    for (const r of rows) {
      const t = out.get(r.projectId) ?? { minutes: 0, approved: 0, billable: 0 };
      const m = r._sum.minutes ?? 0;
      t.minutes += m;
      if (r.status === 'APPROVED') t.approved += m;
      if (r.billable) t.billable += m;
      out.set(r.projectId, t);
    }
    return out;
  }

  private view(p: ProjectRow, t?: { minutes: number; approved: number; billable: number }) {
    const loggedHours = (t?.minutes ?? 0) / 60;
    const budget = num(p.budgetHours);
    return {
      id: p.id,
      companyId: p.companyId,
      code: p.code,
      name: p.name,
      clientName: p.clientName,
      status: p.status,
      billable: p.billable,
      hourlyRate: Number(p.hourlyRate),
      budgetHours: budget,
      startDate: p.startDate ? iso(p.startDate) : null,
      endDate: p.endDate ? iso(p.endDate) : null,
      managerId: p.managerId,
      notes: p.notes,
      loggedHours,
      approvedHours: (t?.approved ?? 0) / 60,
      overBudget: budget !== null && loggedHours > budget,
    };
  }

  list(tenant: TenantContext, auth: AuthContext, q: z.output<typeof projectListQuerySchema>) {
    return this.run(tenant, auth, async (tx) => {
      const me = await this.selfId(tx, tenant);
      const rows = await tx.project.findMany({
        where: q.status ? { status: q.status } : {},
        orderBy: { code: 'asc' },
      });
      const visible = rows.filter((p) => this.canView(tenant, p.companyId) || (me && p.managerId === me));
      const totals = await this.totals(
        tx,
        visible.map((p) => p.id),
      );
      return visible.map((p) => this.view(p, totals.get(p.id)));
    });
  }

  /** The active projects the signed-in employee can log time on. */
  mine(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const me = await this.selfId(tx, tenant);
      if (!me) return [];
      const rows = await tx.projectMember.findMany({
        where: { employeeId: me, project: { status: 'ACTIVE' } },
        include: { project: true },
        orderBy: { project: { name: 'asc' } },
      });
      return rows.map((m) => ({
        id: m.project.id,
        code: m.project.code,
        name: m.project.name,
        clientName: m.project.clientName,
        billable: m.project.billable,
      }));
    });
  }

  async people(tenant: TenantContext, auth: AuthContext, search: string) {
    return this.run(tenant, auth, async (tx) => {
      const term = search.trim();
      const rows = await tx.employee.findMany({
        where: {
          status: { not: 'EXITED' },
          ...(term
            ? {
                OR: [
                  { firstName: { contains: term, mode: 'insensitive' } },
                  { lastName: { contains: term, mode: 'insensitive' } },
                  { employeeCode: { contains: term, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { firstName: 'asc' },
        take: 20,
        select: { id: true, employeeCode: true, firstName: true, lastName: true, preferredName: true },
      });
      return rows.map((e) => ({ id: e.id, code: e.employeeCode, name: displayName(e) }));
    });
  }

  private async requireManager(tx: TenantTransaction, managerId: string | null | undefined) {
    if (!managerId) return;
    const e = await tx.employee.findUnique({ where: { id: managerId }, select: { status: true } });
    if (!e || e.status === 'EXITED') throw invalid('managerId', 'Choose a current employee');
  }

  create(tenant: TenantContext, auth: AuthContext, input: z.output<typeof projectSchema>, meta: RequestMeta) {
    if (!this.canManage(tenant, input.companyId)) throw new ForbiddenError();
    if (input.startDate && input.endDate && input.endDate < input.startDate) {
      throw invalid('endDate', 'The end can’t be before the start');
    }
    return this.run(tenant, auth, async (tx) => {
      const company = await tx.company.findUnique({ where: { id: input.companyId }, select: { id: true } });
      if (!company) throw invalid('companyId', 'Choose a company');
      await this.requireManager(tx, input.managerId);
      try {
        const p = await tx.project.create({
          data: {
            tenantId: tenant.id,
            companyId: input.companyId,
            code: input.code.toUpperCase(),
            name: input.name,
            clientName: input.clientName ?? null,
            billable: input.billable,
            hourlyRate: input.hourlyRate,
            budgetHours: input.budgetHours ?? null,
            startDate: input.startDate ? toDate(input.startDate) : null,
            endDate: input.endDate ? toDate(input.endDate) : null,
            managerId: input.managerId ?? null,
            notes: input.notes ?? null,
          },
        });
        await this.record(tx, tenant, auth, 'projects.project.create', 'project', p.id, meta);
        return this.view(p);
      } catch (error) {
        if (isUniqueViolation(error)) throw invalid('code', 'That project code is already in use');
        throw error;
      }
    });
  }

  update(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateProjectSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const existing = await tx.project.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError('Project');
      if (!this.canManage(tenant, existing.companyId)) throw new ForbiddenError();
      if (input.managerId !== undefined) await this.requireManager(tx, input.managerId);
      const start =
        input.startDate === undefined ? existing.startDate : input.startDate ? toDate(input.startDate) : null;
      const end =
        input.endDate === undefined ? existing.endDate : input.endDate ? toDate(input.endDate) : null;
      if (start && end && end < start) throw invalid('endDate', 'The end can’t be before the start');
      const data: Prisma.ProjectUncheckedUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.clientName !== undefined) data.clientName = input.clientName;
      if (input.status !== undefined) data.status = input.status;
      if (input.billable !== undefined) data.billable = input.billable;
      if (input.hourlyRate !== undefined) data.hourlyRate = input.hourlyRate;
      if (input.budgetHours !== undefined) data.budgetHours = input.budgetHours;
      if (input.startDate !== undefined) data.startDate = start;
      if (input.endDate !== undefined) data.endDate = end;
      if (input.managerId !== undefined) data.managerId = input.managerId;
      if (input.notes !== undefined) data.notes = input.notes;
      const p = await tx.project.update({ where: { id }, data });
      await this.record(tx, tenant, auth, 'projects.project.update', 'project', id, meta);
      const totals = await this.totals(tx, [id]);
      return this.view(p, totals.get(id));
    });
  }

  /** One project with its team and, for those who may see money, what it earned against what the time cost. */
  detail(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, async (tx) => {
      const p = await tx.project.findUnique({ where: { id } });
      if (!p) throw new NotFoundError('Project');
      const me = await this.selfId(tx, tenant);
      const seesAll = this.canView(tenant, p.companyId);
      if (!seesAll && !(me && p.managerId === me)) throw new NotFoundError('Project');
      const members = await tx.projectMember.findMany({
        where: { projectId: id },
        include: {
          employee: {
            select: { id: true, employeeCode: true, firstName: true, lastName: true, preferredName: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      const per = await tx.timeEntry.groupBy({
        by: ['employeeId', 'billable'],
        where: { projectId: id },
        _sum: { minutes: true },
      });
      const minutesOf = (employeeId: string) =>
        per.filter((r) => r.employeeId === employeeId).reduce((s, r) => s + (r._sum.minutes ?? 0), 0);
      const totals = await this.totals(tx, [id]);
      const out = {
        ...this.view(p, totals.get(id)),
        manager: null as { id: string; name: string } | null,
        members: members.map((m) => ({
          employeeId: m.employeeId,
          code: m.employee.employeeCode,
          name: displayName(m.employee),
          costRate: seesAll ? Number(m.costRate) : null,
          hours: minutesOf(m.employeeId) / 60,
        })),
        money: null as null | { revenue: number; cost: number; profit: number },
      };
      if (p.managerId) {
        const m = await tx.employee.findUnique({
          where: { id: p.managerId },
          select: { id: true, firstName: true, lastName: true, preferredName: true },
        });
        if (m) out.manager = { id: m.id, name: displayName(m) };
      }
      if (seesAll) {
        let revenue = 0;
        let cost = 0;
        const rate = paise(Number(p.hourlyRate));
        for (const r of per) {
          const minutes = r._sum.minutes ?? 0;
          if (r.billable && p.billable) revenue += Math.round((minutes * rate) / 60);
          const member = members.find((m) => m.employeeId === r.employeeId);
          if (member) cost += Math.round((minutes * paise(Number(member.costRate))) / 60);
        }
        out.money = { revenue: revenue / 100, cost: cost / 100, profit: (revenue - cost) / 100 };
      }
      return out;
    });
  }

  setMembers(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof projectMembersSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const p = await tx.project.findUnique({ where: { id } });
      if (!p) throw new NotFoundError('Project');
      if (!this.canManage(tenant, p.companyId)) throw new ForbiddenError();
      const ids = input.members.map((m) => m.employeeId);
      const found = await tx.employee.findMany({
        where: { id: { in: ids }, status: { not: 'EXITED' } },
        select: { id: true },
      });
      if (found.length !== ids.length) throw invalid('members', 'Choose current employees');
      const logged = await tx.timeEntry.groupBy({ by: ['employeeId'], where: { projectId: id } });
      const dropped = logged.filter((l) => !ids.includes(l.employeeId));
      if (dropped.length > 0) {
        throw new AppError(
          'MEMBER_HAS_TIME',
          'Someone who has logged time on this project can’t be removed from it',
          409,
        );
      }
      await tx.projectMember.deleteMany({ where: { projectId: id } });
      await tx.projectMember.createMany({
        data: input.members.map((m) => ({
          tenantId: tenant.id,
          projectId: id,
          employeeId: m.employeeId,
          costRate: m.costRate,
        })),
      });
      await this.record(tx, tenant, auth, 'projects.members.set', 'project', id, meta, { count: ids.length });
      return { count: ids.length };
    });
  }

  // ---- Time --------------------------------------------------------------------------------------

  private entryView(
    e: EntryRow & { project?: { code: string; name: string }; employee?: Parameters<typeof displayName>[0] },
  ) {
    return {
      id: e.id,
      projectId: e.projectId,
      project: e.project ? { code: e.project.code, name: e.project.name } : null,
      employeeId: e.employeeId,
      employeeName: e.employee ? displayName(e.employee) : null,
      workDate: iso(e.workDate),
      hours: e.minutes / 60,
      billable: e.billable,
      note: e.note,
      status: e.status,
    };
  }

  private rangeCheck(range: z.output<typeof timeRangeSchema>) {
    if (range.to < range.from) throw invalid('to', 'The end can’t be before the start');
    const days = (toDate(range.to).getTime() - toDate(range.from).getTime()) / 86_400_000;
    if (days > 366) throw invalid('to', 'Choose a range of a year or less');
  }

  /** The signed-in employee's own time in a date range. */
  myTime(tenant: TenantContext, auth: AuthContext, range: z.output<typeof timeRangeSchema>) {
    this.rangeCheck(range);
    return this.run(tenant, auth, async (tx) => {
      const me = await this.attendance.requireSelf(tx, tenant);
      const rows = await tx.timeEntry.findMany({
        where: { employeeId: me.id, workDate: { gte: toDate(range.from), lte: toDate(range.to) } },
        include: { project: { select: { code: true, name: true } } },
        orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }],
      });
      return {
        entries: rows.map((e) => this.entryView(e)),
        totalHours: rows.reduce((s, e) => s + e.minutes, 0) / 60,
      };
    });
  }

  logTime(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof timeEntrySchema>,
    meta: RequestMeta,
    now = new Date(),
  ) {
    const minutes = Math.round(input.hours * 60);
    if (minutes < 1) throw invalid('hours', 'Enter at least a minute');
    if (input.workDate > iso(now)) throw invalid('workDate', 'You can’t log time in the future');
    return this.run(tenant, auth, async (tx) => {
      const me = await this.attendance.requireSelf(tx, tenant);
      if (me.status === 'EXITED')
        throw new AppError('EMPLOYEE_EXITED', 'You have left the organisation', 409);
      const project = await tx.project.findUnique({ where: { id: input.projectId } });
      const member = project
        ? await tx.projectMember.findFirst({ where: { projectId: project.id, employeeId: me.id } })
        : null;
      if (!project || !member) throw invalid('projectId', 'You aren’t on that project');
      if (project.status !== 'ACTIVE') throw invalid('projectId', 'That project isn’t active');
      if (project.startDate && toDate(input.workDate) < project.startDate) {
        throw invalid('workDate', 'That is before the project started');
      }
      try {
        const e = await tx.timeEntry.create({
          data: {
            tenantId: tenant.id,
            projectId: project.id,
            employeeId: me.id,
            workDate: toDate(input.workDate),
            minutes,
            billable: (input.billable ?? true) && project.billable,
            note: input.note ?? null,
          },
        });
        await this.record(tx, tenant, auth, 'projects.time.log', 'time_entry', e.id, meta, { minutes });
        return this.entryView(e);
      } catch (error) {
        return timeError(error);
      }
    });
  }

  private async ownEntry(tx: TenantTransaction, tenant: TenantContext, id: string) {
    const me = await this.attendance.requireSelf(tx, tenant);
    const e = await tx.timeEntry.findUnique({ where: { id } });
    if (!e || e.employeeId !== me.id) throw new NotFoundError('Time entry');
    if (e.status === 'APPROVED') throw new AppError('TIME_APPROVED', 'Approved time can’t be changed', 409);
    return e;
  }

  updateTime(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateTimeEntrySchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const e = await this.ownEntry(tx, tenant, id);
      const data: Prisma.TimeEntryUncheckedUpdateInput = {};
      if (input.hours !== undefined) {
        const minutes = Math.round(input.hours * 60);
        if (minutes < 1) throw invalid('hours', 'Enter at least a minute');
        data.minutes = minutes;
      }
      if (input.billable !== undefined) {
        const project = await tx.project.findUniqueOrThrow({ where: { id: e.projectId } });
        data.billable = input.billable && project.billable;
      }
      if (input.note !== undefined) data.note = input.note;
      try {
        const updated = await tx.timeEntry.update({ where: { id }, data });
        await this.record(tx, tenant, auth, 'projects.time.update', 'time_entry', id, meta);
        return this.entryView(updated);
      } catch (error) {
        return timeError(error);
      }
    });
  }

  deleteTime(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      await this.ownEntry(tx, tenant, id);
      try {
        await tx.timeEntry.delete({ where: { id } });
      } catch (error) {
        return timeError(error);
      }
      await this.record(tx, tenant, auth, 'projects.time.delete', 'time_entry', id, meta);
      return { deleted: true };
    });
  }

  /** Everyone's time on a project, for the people who run it. */
  projectTime(tenant: TenantContext, auth: AuthContext, id: string, range: z.output<typeof timeRangeSchema>) {
    this.rangeCheck(range);
    return this.run(tenant, auth, async (tx) => {
      const p = await tx.project.findUnique({ where: { id } });
      if (!p) throw new NotFoundError('Project');
      const me = await this.selfId(tx, tenant);
      if (!this.canView(tenant, p.companyId) && !(me && p.managerId === me))
        throw new NotFoundError('Project');
      const rows = await tx.timeEntry.findMany({
        where: { projectId: id, workDate: { gte: toDate(range.from), lte: toDate(range.to) } },
        include: {
          employee: { select: { firstName: true, lastName: true, preferredName: true } },
        },
        orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }],
        take: 5000,
      });
      return rows.map((e) => this.entryView(e));
    });
  }

  /** Approves the open time on a project in a range. Managers don't approve their own hours. */
  approve(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof approveTimeSchema>,
    meta: RequestMeta,
  ) {
    this.rangeCheck(input);
    return this.run(tenant, auth, async (tx) => {
      const p = await tx.project.findUnique({ where: { id: input.projectId } });
      if (!p) throw new NotFoundError('Project');
      const me = await this.selfId(tx, tenant);
      const manages = this.canManage(tenant, p.companyId);
      if (!manages && !(me && p.managerId === me)) throw new ForbiddenError();
      const { count } = await tx.timeEntry.updateMany({
        where: {
          projectId: p.id,
          status: 'OPEN',
          workDate: { gte: toDate(input.from), lte: toDate(input.to) },
          AND: [
            ...(input.employeeId ? [{ employeeId: input.employeeId }] : []),
            ...(manages || !me ? [] : [{ employeeId: { not: me } }]),
          ],
        },
        data: { status: 'APPROVED', approvedByUserId: auth.user.id, approvedAt: new Date() },
      });
      await this.record(tx, tenant, auth, 'projects.time.approve', 'project', p.id, meta, { entries: count });
      return { approved: count };
    });
  }
}
