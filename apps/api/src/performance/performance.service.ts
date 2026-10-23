import { Injectable } from '@nestjs/common';
import { isUniqueViolation, type Prisma, type TenantTransaction } from '@smart-hr/database';
import { AppError, ForbiddenError, NotFoundError, type ScopeRef } from '@smart-hr/shared';
import {
  weightedProgress,
  type appraisalListQuerySchema,
  type colleagueFeedbackSchema,
  type goalSchema,
  type managerReviewSchema,
  type reviewCycleSchema,
  type selfReviewSchema,
  type updateGoalSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { AttendanceService, toDate } from '../attendance/attendance.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { displayName } from '../employees/employees.service.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);

const companyScopes = (tenantId: string, companyId: string): ScopeRef[] => [
  { type: 'TENANT', id: tenantId },
  { type: 'COMPANY', id: companyId },
];

const NAME = { id: true, employeeCode: true, firstName: true, lastName: true, preferredName: true } as const;
type Named = Prisma.EmployeeGetPayload<{ select: typeof NAME }>;
const person = (e: Named | null) => (e ? { id: e.id, code: e.employeeCode, name: displayName(e) } : null);

function invalid(path: string, message: string) {
  return new AppError('VALIDATION_FAILED', message, 400, [{ path, message }]);
}

/** The database enforces the rules below; this turns its refusals into plain words. */
function performanceError(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('review cycle is closed')) {
    throw new AppError('CYCLE_CLOSED', 'This review cycle is closed', 409);
  }
  if (message.includes('weights add up to more than 100')) {
    throw new AppError('WEIGHT_TOO_HIGH', 'Goal weights can add up to 100 at most', 409);
  }
  if (message.includes('cannot go from') || message.includes('cannot be rated again')) {
    throw new AppError('WRONG_STEP', 'That step has already happened or isn’t due yet', 409);
  }
  throw error;
}

type CycleRow = Prisma.ReviewCycleGetPayload<object>;
type GoalRow = Prisma.PerformanceGoalGetPayload<object>;
type AppraisalRow = Prisma.AppraisalGetPayload<{
  include: { employee: { select: typeof NAME }; reviewer: { select: typeof NAME }; cycle: true };
}>;

/**
 * Performance management. HR sets up a cycle for a company and opens it, which starts a review for every
 * current employee. People set weighted goals and update progress; each person rates themselves, their
 * manager rates them, and they acknowledge the result. Colleagues can also send each other feedback at any time.
 */
@Injectable()
export class PerformanceService {
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
    return tenant.permissions.allows('performance.manage', companyScopes(tenant.id, companyId));
  }

  private canView(tenant: TenantContext, companyId: string) {
    return (
      this.canManage(tenant, companyId) ||
      tenant.permissions.allows('performance.view', companyScopes(tenant.id, companyId))
    );
  }

  private async selfId(tx: TenantTransaction, tenant: TenantContext) {
    return (await this.attendance.self(tx, tenant))?.id ?? null;
  }

  // ---- Cycles ------------------------------------------------------------------------------------

  private cycleView(c: CycleRow, counts?: { people: number; completed: number }) {
    return {
      id: c.id,
      companyId: c.companyId,
      name: c.name,
      periodFrom: iso(c.periodFrom),
      periodTo: iso(c.periodTo),
      status: c.status,
      openedAt: c.openedAt?.toISOString() ?? null,
      closedAt: c.closedAt?.toISOString() ?? null,
      people: counts?.people ?? 0,
      completed: counts?.completed ?? 0,
    };
  }

  private async cycleCounts(tx: TenantTransaction, cycleIds: string[]) {
    const rows = await tx.appraisal.groupBy({
      by: ['cycleId', 'status'],
      where: { cycleId: { in: cycleIds } },
      _count: { _all: true },
    });
    const out = new Map<string, { people: number; completed: number }>();
    for (const r of rows) {
      const t = out.get(r.cycleId) ?? { people: 0, completed: 0 };
      t.people += r._count._all;
      if (r.status === 'COMPLETED' || r.status === 'ACKNOWLEDGED') t.completed += r._count._all;
      out.set(r.cycleId, t);
    }
    return out;
  }

  /** Cycles the member runs or can see across the organisation. */
  listCycles(tenant: TenantContext, auth: AuthContext, companyId?: string) {
    return this.run(tenant, auth, async (tx) => {
      const rows = await tx.reviewCycle.findMany({
        where: companyId ? { companyId } : {},
        orderBy: { periodTo: 'desc' },
        take: 100,
      });
      const visible = rows.filter((c) => this.canView(tenant, c.companyId));
      const counts = await this.cycleCounts(
        tx,
        visible.map((c) => c.id),
      );
      return visible.map((c) => this.cycleView(c, counts.get(c.id)));
    });
  }

  createCycle(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof reviewCycleSchema>,
    meta: RequestMeta,
  ) {
    if (!this.canManage(tenant, input.companyId)) throw new ForbiddenError();
    return this.run(tenant, auth, async (tx) => {
      const company = await tx.company.findUnique({ where: { id: input.companyId }, select: { id: true } });
      if (!company) throw invalid('companyId', 'Choose a company');
      try {
        const c = await tx.reviewCycle.create({
          data: {
            tenantId: tenant.id,
            companyId: input.companyId,
            name: input.name,
            periodFrom: toDate(input.periodFrom),
            periodTo: toDate(input.periodTo),
            createdByUserId: auth.user.id,
          },
        });
        await this.record(tx, tenant, auth, 'performance.cycle.create', 'review_cycle', c.id, meta);
        return this.cycleView(c);
      } catch (error) {
        if (isUniqueViolation(error))
          throw invalid('name', 'This company already has a cycle with that name');
        throw error;
      }
    });
  }

  /** Opening starts a review for every current employee who had joined by the end of the period. */
  openCycle(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const cycle = await tx.reviewCycle.findUnique({ where: { id } });
      if (!cycle) throw new NotFoundError('Review cycle');
      if (!this.canManage(tenant, cycle.companyId)) throw new ForbiddenError();
      if (cycle.status !== 'DRAFT')
        throw new AppError('WRONG_STEP', 'This cycle is already open or closed', 409);
      const people = await tx.employee.findMany({
        where: {
          companyId: cycle.companyId,
          status: { not: 'EXITED' },
          dateOfJoining: { lte: cycle.periodTo },
        },
        select: { id: true, managerId: true },
      });
      if (people.length === 0) {
        throw new AppError('NO_PEOPLE', 'There is nobody to review in this company for that period', 409);
      }
      const opened = await tx.reviewCycle.update({
        where: { id },
        data: { status: 'OPEN', openedAt: new Date() },
      });
      await tx.appraisal.createMany({
        data: people.map((p) => ({
          tenantId: tenant.id,
          cycleId: id,
          employeeId: p.id,
          reviewerId: p.managerId && p.managerId !== p.id ? p.managerId : null,
        })),
      });
      await this.record(tx, tenant, auth, 'performance.cycle.open', 'review_cycle', id, meta, {
        people: people.length,
      });
      return this.cycleView(opened, { people: people.length, completed: 0 });
    });
  }

  closeCycle(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const cycle = await tx.reviewCycle.findUnique({ where: { id } });
      if (!cycle) throw new NotFoundError('Review cycle');
      if (!this.canManage(tenant, cycle.companyId)) throw new ForbiddenError();
      if (cycle.status !== 'OPEN') throw new AppError('WRONG_STEP', 'Only an open cycle can be closed', 409);
      const closed = await tx.reviewCycle.update({
        where: { id },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
      const counts = await this.cycleCounts(tx, [id]);
      await this.record(tx, tenant, auth, 'performance.cycle.close', 'review_cycle', id, meta);
      return this.cycleView(closed, counts.get(id));
    });
  }

  // ---- Goals -------------------------------------------------------------------------------------

  private goalView(g: GoalRow) {
    return {
      id: g.id,
      cycleId: g.cycleId,
      employeeId: g.employeeId,
      title: g.title,
      description: g.description,
      weight: g.weight,
      progress: g.progress,
      status: g.status,
    };
  }

  /** The person themself, their manager, or HR for that company may work on a person's goals. */
  private async mayWorkOnGoals(
    tx: TenantTransaction,
    tenant: TenantContext,
    employee: { id: string; managerId: string | null; companyId: string },
  ) {
    if (this.canManage(tenant, employee.companyId)) return true;
    const me = await this.selfId(tx, tenant);
    return !!me && (me === employee.id || me === employee.managerId);
  }

  async createGoal(tenant: TenantContext, auth: AuthContext, input: z.output<typeof goalSchema>) {
    return this.run(tenant, auth, async (tx) => {
      const cycle = await tx.reviewCycle.findUnique({ where: { id: input.cycleId } });
      if (!cycle) throw new NotFoundError('Review cycle');
      const me = await this.selfId(tx, tenant);
      const employeeId = input.employeeId ?? me;
      if (!employeeId) {
        throw new AppError('NO_EMPLOYEE_RECORD', 'Your account isn’t linked to an employee record.', 404);
      }
      const employee = await tx.employee.findUnique({
        where: { id: employeeId },
        select: { id: true, managerId: true, companyId: true, status: true },
      });
      if (!employee || employee.companyId !== cycle.companyId || employee.status === 'EXITED') {
        throw invalid('employeeId', 'Choose a current employee of this cycle’s company');
      }
      if (!(await this.mayWorkOnGoals(tx, tenant, employee))) throw new ForbiddenError();
      try {
        const g = await tx.performanceGoal.create({
          data: {
            tenantId: tenant.id,
            cycleId: cycle.id,
            employeeId,
            title: input.title,
            description: input.description ?? null,
            weight: input.weight,
          },
        });
        return this.goalView(g);
      } catch (error) {
        return performanceError(error);
      }
    });
  }

  private async loadGoal(tx: TenantTransaction, tenant: TenantContext, id: string) {
    const goal = await tx.performanceGoal.findUnique({
      where: { id },
      include: { employee: { select: { id: true, managerId: true, companyId: true } } },
    });
    if (!goal) throw new NotFoundError('Goal');
    if (!(await this.mayWorkOnGoals(tx, tenant, goal.employee))) throw new NotFoundError('Goal');
    return goal;
  }

  updateGoal(tenant: TenantContext, auth: AuthContext, id: string, input: z.output<typeof updateGoalSchema>) {
    return this.run(tenant, auth, async (tx) => {
      await this.loadGoal(tx, tenant, id);
      try {
        const g = await tx.performanceGoal.update({
          where: { id },
          data: {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.weight !== undefined ? { weight: input.weight } : {}),
            ...(input.progress !== undefined ? { progress: input.progress } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
          },
        });
        return this.goalView(g);
      } catch (error) {
        return performanceError(error);
      }
    });
  }

  /** A goal nobody has made progress on can be removed; otherwise it is marked dropped. */
  removeGoal(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, async (tx) => {
      const goal = await this.loadGoal(tx, tenant, id);
      try {
        if (goal.progress === 0 && goal.status === 'ACTIVE') {
          await tx.performanceGoal.delete({ where: { id } });
          return { removed: true, goal: null };
        }
        const g = await tx.performanceGoal.update({ where: { id }, data: { status: 'DROPPED' } });
        return { removed: false, goal: this.goalView(g) };
      } catch (error) {
        return performanceError(error);
      }
    });
  }

  // ---- Appraisals --------------------------------------------------------------------------------

  private appraisalView(
    a: AppraisalRow,
    goals: GoalRow[],
    viewer: { employeeId: string | null; canSeeAll: boolean },
  ) {
    const isSubject = viewer.employeeId === a.employeeId;
    // The manager's rating stays out of the employee's sight until the review is complete.
    const released = a.status === 'COMPLETED' || a.status === 'ACKNOWLEDGED';
    const hide = isSubject && !viewer.canSeeAll && !released;
    return {
      id: a.id,
      cycle: { id: a.cycle.id, name: a.cycle.name, status: a.cycle.status, companyId: a.cycle.companyId },
      employee: person(a.employee),
      reviewer: person(a.reviewer),
      status: a.status,
      selfRating: a.selfRating,
      selfComment: a.selfComment,
      managerRating: hide ? null : a.managerRating,
      managerComment: hide ? null : a.managerComment,
      completedAt: a.completedAt?.toISOString() ?? null,
      acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
      goals: goals.map((g) => this.goalView(g)),
      goalProgress: weightedProgress(goals),
    };
  }

  private readonly appraisalInclude = {
    employee: { select: NAME },
    reviewer: { select: NAME },
    cycle: true,
  } as const;

  private async visibleAppraisal(tx: TenantTransaction, tenant: TenantContext, id: string) {
    const a = await tx.appraisal.findUnique({ where: { id }, include: this.appraisalInclude });
    if (!a) throw new NotFoundError('Appraisal');
    const me = await this.selfId(tx, tenant);
    const canSeeAll = this.canView(tenant, a.cycle.companyId);
    const mine = !!me && (a.employeeId === me || a.reviewerId === me);
    if (!canSeeAll && !mine) throw new NotFoundError('Appraisal');
    return { a, me, canSeeAll };
  }

  private goalsFor(tx: TenantTransaction, cycleId: string, employeeId: string) {
    return tx.performanceGoal.findMany({ where: { cycleId, employeeId }, orderBy: { createdAt: 'asc' } });
  }

  listAppraisals(
    tenant: TenantContext,
    auth: AuthContext,
    cycleId: string,
    q: z.output<typeof appraisalListQuerySchema>,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const cycle = await tx.reviewCycle.findUnique({ where: { id: cycleId } });
      if (!cycle) throw new NotFoundError('Review cycle');
      const me = await this.selfId(tx, tenant);
      const canSeeAll = this.canView(tenant, cycle.companyId);
      const rows = await tx.appraisal.findMany({
        where: {
          cycleId,
          ...(q.status === 'ALL' ? {} : { status: q.status }),
          ...(canSeeAll ? {} : { OR: [{ employeeId: me ?? 'none' }, { reviewerId: me ?? 'none' }] }),
        },
        include: this.appraisalInclude,
        orderBy: { employee: { firstName: 'asc' } },
        take: 2000,
      });
      const goals = await tx.performanceGoal.findMany({
        where: { cycleId, employeeId: { in: rows.map((r) => r.employeeId) } },
      });
      return rows.map((a) =>
        this.appraisalView(
          a,
          goals.filter((g) => g.employeeId === a.employeeId),
          { employeeId: me, canSeeAll },
        ),
      );
    });
  }

  /** Reviews waiting on the signed-in manager. */
  toReview(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const me = await this.selfId(tx, tenant);
      if (!me) return [];
      const rows = await tx.appraisal.findMany({
        where: { reviewerId: me, status: 'AWAITING_MANAGER', cycle: { status: 'OPEN' } },
        include: this.appraisalInclude,
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      return rows.map((a) => this.appraisalView(a, [], { employeeId: me, canSeeAll: false }));
    });
  }

  getAppraisal(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, async (tx) => {
      const { a, me, canSeeAll } = await this.visibleAppraisal(tx, tenant, id);
      const goals = await this.goalsFor(tx, a.cycleId, a.employeeId);
      return this.appraisalView(a, goals, { employeeId: me, canSeeAll });
    });
  }

  /** The signed-in employee's cycles: their goals and review for each. */
  mine(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const me = await this.attendance.self(tx, tenant);
      if (!me) return { linked: false, cycles: [] };
      const employee = await tx.employee.findUnique({ where: { id: me.id }, select: { companyId: true } });
      const cycles = await tx.reviewCycle.findMany({
        where: {
          OR: [
            { companyId: employee?.companyId ?? 'none', status: { in: ['DRAFT', 'OPEN'] } },
            { appraisals: { some: { employeeId: me.id } } },
          ],
        },
        orderBy: { periodTo: 'desc' },
        take: 12,
      });
      const goals = await tx.performanceGoal.findMany({
        where: { employeeId: me.id, cycleId: { in: cycles.map((c) => c.id) } },
        orderBy: { createdAt: 'asc' },
      });
      const appraisals = await tx.appraisal.findMany({
        where: { employeeId: me.id, cycleId: { in: cycles.map((c) => c.id) } },
        include: this.appraisalInclude,
      });
      return {
        linked: true,
        cycles: cycles.map((c) => {
          const mineGoals = goals.filter((g) => g.cycleId === c.id);
          const appraisal = appraisals.find((a) => a.cycleId === c.id);
          return {
            cycle: this.cycleView(c),
            goals: mineGoals.map((g) => this.goalView(g)),
            goalProgress: weightedProgress(mineGoals),
            appraisal: appraisal
              ? this.appraisalView(appraisal, mineGoals, { employeeId: me.id, canSeeAll: false })
              : null,
          };
        }),
      };
    });
  }

  selfReview(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof selfReviewSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const me = await this.selfId(tx, tenant);
      const a = await tx.appraisal.findUnique({ where: { id }, include: { cycle: true } });
      if (!a || !me || a.employeeId !== me) throw new NotFoundError('Appraisal');
      if (a.cycle.status !== 'OPEN') throw new AppError('CYCLE_CLOSED', 'This review cycle isn’t open', 409);
      if (a.status !== 'AWAITING_SELF')
        throw new AppError('WRONG_STEP', 'You have already submitted this', 409);
      try {
        await tx.appraisal.update({
          where: { id },
          data: {
            status: 'AWAITING_MANAGER',
            selfRating: input.rating,
            selfComment: input.comment,
            selfSubmittedAt: new Date(),
          },
        });
      } catch (error) {
        performanceError(error);
      }
      await this.record(tx, tenant, auth, 'performance.appraisal.self', 'appraisal', id, meta);
      return this.fresh(tx, tenant, id);
    });
  }

  managerReview(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof managerReviewSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const me = await this.selfId(tx, tenant);
      const a = await tx.appraisal.findUnique({ where: { id }, include: { cycle: true } });
      if (!a) throw new NotFoundError('Appraisal');
      const isReviewer = !!me && a.reviewerId === me && a.employeeId !== me;
      if (!isReviewer && !this.canManage(tenant, a.cycle.companyId)) throw new NotFoundError('Appraisal');
      if (a.employeeId === me && !this.canManage(tenant, a.cycle.companyId)) throw new ForbiddenError();
      if (a.cycle.status !== 'OPEN') throw new AppError('CYCLE_CLOSED', 'This review cycle isn’t open', 409);
      if (a.status !== 'AWAITING_MANAGER') {
        throw new AppError(
          'WRONG_STEP',
          a.status === 'AWAITING_SELF'
            ? 'They haven’t submitted their own review yet'
            : 'This is already complete',
          409,
        );
      }
      try {
        await tx.appraisal.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            managerRating: input.rating,
            managerComment: input.comment,
            reviewedByUserId: auth.user.id,
            completedAt: new Date(),
          },
        });
      } catch (error) {
        performanceError(error);
      }
      await this.record(tx, tenant, auth, 'performance.appraisal.review', 'appraisal', id, meta, {
        rating: input.rating,
      });
      return this.fresh(tx, tenant, id);
    });
  }

  acknowledge(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const me = await this.selfId(tx, tenant);
      const a = await tx.appraisal.findUnique({ where: { id } });
      if (!a || !me || a.employeeId !== me) throw new NotFoundError('Appraisal');
      if (a.status !== 'COMPLETED') {
        throw new AppError('WRONG_STEP', 'There is nothing to acknowledge yet', 409);
      }
      try {
        await tx.appraisal.update({
          where: { id },
          data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() },
        });
      } catch (error) {
        performanceError(error);
      }
      await this.record(tx, tenant, auth, 'performance.appraisal.acknowledge', 'appraisal', id, meta);
      return this.fresh(tx, tenant, id);
    });
  }

  private async fresh(tx: TenantTransaction, tenant: TenantContext, id: string) {
    const { a, me, canSeeAll } = await this.visibleAppraisal(tx, tenant, id);
    const goals = await this.goalsFor(tx, a.cycleId, a.employeeId);
    return this.appraisalView(a, goals, { employeeId: me, canSeeAll });
  }

  // ---- Feedback ----------------------------------------------------------------------------------

  feedback(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const me = await this.selfId(tx, tenant);
      if (!me) return { received: [], given: [] };
      const include = { from: { select: NAME }, to: { select: NAME } } as const;
      const [received, given] = await Promise.all([
        tx.feedbackNote.findMany({ where: { toId: me }, include, orderBy: { createdAt: 'desc' }, take: 100 }),
        tx.feedbackNote.findMany({
          where: { fromId: me },
          include,
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
      ]);
      const view = (n: (typeof received)[number]) => ({
        id: n.id,
        kind: n.kind,
        message: n.message,
        createdAt: n.createdAt.toISOString(),
        from: person(n.from),
        to: person(n.to),
      });
      return { received: received.map(view), given: given.map(view) };
    });
  }

  giveFeedback(tenant: TenantContext, auth: AuthContext, input: z.output<typeof colleagueFeedbackSchema>) {
    return this.run(tenant, auth, async (tx) => {
      const me = await this.selfId(tx, tenant);
      if (!me) {
        throw new AppError('NO_EMPLOYEE_RECORD', 'Your account isn’t linked to an employee record.', 404);
      }
      if (input.toId === me) throw invalid('toId', 'Choose a colleague, not yourself');
      const to = await tx.employee.findUnique({
        where: { id: input.toId },
        select: { id: true, status: true },
      });
      if (!to || to.status === 'EXITED') throw invalid('toId', 'Choose a current employee');
      const n = await tx.feedbackNote.create({
        data: { tenantId: tenant.id, fromId: me, toId: input.toId, kind: input.kind, message: input.message },
      });
      return { id: n.id };
    });
  }

  people(tenant: TenantContext, auth: AuthContext, search: string) {
    return this.run(tenant, auth, async (tx) => {
      const me = await this.selfId(tx, tenant);
      const term = search.trim();
      const rows = await tx.employee.findMany({
        where: {
          status: { not: 'EXITED' },
          ...(me ? { id: { not: me } } : {}),
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
        select: NAME,
      });
      return rows.map((e) => person(e));
    });
  }
}
