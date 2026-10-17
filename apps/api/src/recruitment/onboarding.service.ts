import { Inject, Injectable } from '@nestjs/common';
import { withContext, type DatabaseClient, type Prisma, type TenantTransaction } from '@smart-hr/database';
import { AppError, ForbiddenError, NotFoundError } from '@smart-hr/shared';
import type { completeTaskSchema, onboardingTemplateSchema } from '@smart-hr/validation';
import type { z } from 'zod';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { displayName, toDate } from '../employees/employees.service.js';
import { OrgIndex } from '../employees/org-index.js';
import { DATABASE } from '../infra/tokens.js';
import { RecruitmentService } from './recruitment.service.js';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const DAY = 86_400_000;

const PLAN_INCLUDE = {
  tasks: { orderBy: { position: 'asc' as const } },
  employee: {
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      membershipId: true,
      managerId: true,
      companyId: true,
      branchId: true,
      departmentId: true,
    },
  },
} satisfies Prisma.OnboardingPlanInclude;
type PlanRow = Prisma.OnboardingPlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

/**
 * Onboarding checklists. HR (onboarding.manage) keeps templates of tasks, each for HR, the new joiner's
 * manager or the joiner themself, due a number of days from the joining date; starting onboarding copies a
 * template into a plan with real people and dates. Each person sees and ticks off their own tasks.
 */
@Injectable()
export class OnboardingService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly recruitment: RecruitmentService,
  ) {}

  run<T>(tenant: TenantContext, auth: AuthContext, work: (tx: TenantTransaction) => Promise<T>) {
    return withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, work);
  }

  private assertManage(tenant: TenantContext) {
    if (!tenant.permissions.hasAnywhere('onboarding.manage')) throw new ForbiddenError();
  }

  // ---- Templates --------------------------------------------------------------------------------

  async templates(tenant: TenantContext, auth: AuthContext) {
    this.assertManage(tenant);
    return this.run(tenant, auth, (tx) =>
      tx.onboardingTemplate.findMany({
        include: { tasks: { orderBy: { position: 'asc' } } },
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
      }),
    );
  }

  async saveTemplate(
    tenant: TenantContext,
    auth: AuthContext,
    id: string | null,
    input: z.output<typeof onboardingTemplateSchema>,
    meta: RequestMeta,
  ) {
    this.assertManage(tenant);
    return this.run(tenant, auth, async (tx) => {
      const clash = await tx.onboardingTemplate.findFirst({
        where: { name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) },
        select: { id: true },
      });
      if (clash) {
        throw new AppError('NAME_TAKEN', 'A checklist with this name already exists', 409, [
          { path: 'name', message: 'Already used' },
        ]);
      }
      let templateId = id;
      if (id) {
        const t = await tx.onboardingTemplate.findUnique({ where: { id } });
        if (!t) throw new NotFoundError('Checklist');
        await tx.onboardingTemplate.update({
          where: { id },
          data: { name: input.name, status: input.status },
        });
        // Plans already started keep their own copy of the tasks, so a template can be rewritten freely.
        await tx.onboardingTemplateTask.deleteMany({ where: { templateId: id } });
      } else {
        templateId = (
          await tx.onboardingTemplate.create({
            data: { tenantId: tenant.id, name: input.name, status: input.status },
          })
        ).id;
      }
      await tx.onboardingTemplateTask.createMany({
        data: input.tasks.map((t, i) => ({
          tenantId: tenant.id,
          templateId: templateId!,
          position: i + 1,
          title: t.title,
          description: t.description ?? null,
          assignee: t.assignee,
          dueOffsetDays: t.dueOffsetDays,
        })),
      });
      await this.recruitment.record(
        tx,
        tenant,
        auth,
        id ? 'onboarding.template.update' : 'onboarding.template.create',
        'onboarding_template',
        templateId!,
        meta,
      );
      return tx.onboardingTemplate.findUniqueOrThrow({
        where: { id: templateId! },
        include: { tasks: { orderBy: { position: 'asc' } } },
      });
    });
  }

  // ---- Plans ------------------------------------------------------------------------------------

  /** Who may see an employee's onboarding: HR where they sit, the employee, or their manager. */
  private async planAccess(tx: TenantTransaction, tenant: TenantContext, e: PlanRow['employee']) {
    const org = await OrgIndex.load(tx, tenant.id);
    const manage = tenant.permissions.allows('onboarding.manage', org.scopesOf(e));
    const self = e.membershipId === tenant.membershipId;
    const me = await this.recruitment.myEmployeeId(tx, tenant);
    const manager = !!me && me === e.managerId;
    return { manage, self, manager, any: manage || self || manager };
  }

  private present(p: PlanRow, users: Map<string, string>, access: { manage: boolean }, userId: string) {
    const done = p.tasks.filter((t) => t.status !== 'OPEN').length;
    return {
      id: p.id,
      employee: { id: p.employee.id, name: displayName(p.employee), employeeCode: p.employee.employeeCode },
      templateName: p.templateName,
      startDate: iso(p.startDate),
      status: p.status,
      completedAt: p.completedAt,
      progress: { done, total: p.tasks.length },
      tasks: p.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        assignee: t.assignee,
        assigneeName: t.assigneeUserId ? (users.get(t.assigneeUserId) ?? null) : null,
        dueDate: iso(t.dueDate),
        status: t.status,
        completedAt: t.completedAt,
        completedBy: t.completedByUserId ? (users.get(t.completedByUserId) ?? null) : null,
        note: t.note,
        canUpdate: p.status === 'ACTIVE' && (access.manage || t.assigneeUserId === userId),
      })),
      can: { manage: access.manage, cancel: access.manage && p.status === 'ACTIVE' },
    };
  }

  private async userNames(tx: TenantTransaction, plans: PlanRow[]) {
    const ids = [
      ...new Set(
        plans.flatMap((p) =>
          p.tasks.flatMap((t) => [t.assigneeUserId, t.completedByUserId]).filter((x): x is string => !!x),
        ),
      ),
    ];
    const users = ids.length
      ? await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } })
      : [];
    return new Map(users.map((u) => [u.id, u.displayName]));
  }

  /** Starts onboarding inside the caller's transaction (also used when a candidate is hired). */
  async startIn(
    tx: TenantTransaction,
    tenant: TenantContext,
    auth: AuthContext,
    employeeId: string,
    templateId: string,
    startDate: string | null,
    meta: RequestMeta,
  ) {
    const e = await tx.employee.findUnique({
      where: { id: employeeId },
      select: { ...PLAN_INCLUDE.employee.select, dateOfJoining: true, status: true },
    });
    if (!e) throw new NotFoundError('Employee');
    const access = await this.planAccess(tx, tenant, e);
    if (!access.manage) {
      if (access.any) throw new ForbiddenError();
      throw new NotFoundError('Employee');
    }
    if (e.status === 'EXITED') throw new AppError('EMPLOYEE_EXITED', 'This employee has left', 409);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`onboarding:${employeeId}`}))`;
    const active = await tx.onboardingPlan.count({ where: { employeeId, status: 'ACTIVE' } });
    if (active)
      throw new AppError('ONBOARDING_ACTIVE', 'Onboarding has already started for this employee', 409);
    const template = await tx.onboardingTemplate.findFirst({
      where: { id: templateId, status: 'ACTIVE' },
      include: { tasks: { orderBy: { position: 'asc' } } },
    });
    if (!template) throw new NotFoundError('Checklist');
    const start = startDate ? toDate(startDate) : e.dateOfJoining;

    const userOf = async (membershipId: string | null) => {
      if (!membershipId) return null;
      const m = await tx.tenantMembership.findUnique({
        where: { id: membershipId },
        select: { userId: true, status: true },
      });
      return m && m.status === 'ACTIVE' ? m.userId : null;
    };
    const employeeUser = await userOf(e.membershipId);
    const manager = e.managerId
      ? await tx.employee.findUnique({ where: { id: e.managerId }, select: { membershipId: true } })
      : null;
    const managerUser = await userOf(manager?.membershipId ?? null);
    // A task for someone without a sign-in falls to the HR person who started onboarding.
    const assigneeFor = (kind: 'HR' | 'MANAGER' | 'EMPLOYEE') =>
      kind === 'EMPLOYEE'
        ? (employeeUser ?? auth.user.id)
        : kind === 'MANAGER'
          ? (managerUser ?? auth.user.id)
          : auth.user.id;

    const plan = await tx.onboardingPlan.create({
      data: {
        tenantId: tenant.id,
        employeeId,
        templateName: template.name,
        startDate: start,
        createdByUserId: auth.user.id,
        tasks: {
          create: template.tasks.map((t) => ({
            position: t.position,
            title: t.title,
            description: t.description,
            assignee: t.assignee,
            assigneeUserId: assigneeFor(t.assignee),
            dueDate: new Date(start.getTime() + t.dueOffsetDays * DAY),
          })),
        },
      },
    });
    const name = displayName(e);
    const counts = new Map<string, number>();
    for (const t of template.tasks) {
      const u = assigneeFor(t.assignee);
      if (u !== auth.user.id) counts.set(u, (counts.get(u) ?? 0) + 1);
    }
    for (const [userId, n] of counts) {
      await this.recruitment.notify(
        tx,
        tenant.id,
        'onboarding.task',
        [userId],
        `Onboarding: ${n} task${n === 1 ? '' : 's'} for ${userId === employeeUser ? 'you' : name}`,
        userId === employeeUser
          ? `Welcome! There ${n === 1 ? 'is a task' : `are ${n} tasks`} for you to finish as you join.`
          : `${name} is joining. There ${n === 1 ? 'is a task' : `are ${n} tasks`} for you on their onboarding checklist.`,
        '/onboarding',
      );
    }
    await this.recruitment.record(tx, tenant, auth, 'onboarding.start', 'onboarding_plan', plan.id, meta, {
      employeeId,
      template: template.name,
    });
    return plan.id;
  }

  async start(
    tenant: TenantContext,
    auth: AuthContext,
    employeeId: string,
    templateId: string,
    startDate: string | undefined,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const id = await this.startIn(tx, tenant, auth, employeeId, templateId, startDate ?? null, meta);
      return this.viewPlan(tx, tenant, auth, id);
    });
  }

  private async viewPlan(tx: TenantTransaction, tenant: TenantContext, auth: AuthContext, id: string) {
    const p = await tx.onboardingPlan.findUniqueOrThrow({ where: { id }, include: PLAN_INCLUDE });
    const access = await this.planAccess(tx, tenant, p.employee);
    return this.present(p, await this.userNames(tx, [p]), access, auth.user.id);
  }

  /** An employee's onboarding plans, newest first. */
  async forEmployee(tenant: TenantContext, auth: AuthContext, employeeId: string) {
    return this.run(tenant, auth, async (tx) => {
      const e = await tx.employee.findUnique({
        where: { id: employeeId },
        select: PLAN_INCLUDE.employee.select,
      });
      if (!e) throw new NotFoundError('Employee');
      const access = await this.planAccess(tx, tenant, e);
      if (!access.any) throw new NotFoundError('Employee');
      const plans = await tx.onboardingPlan.findMany({
        where: { employeeId },
        include: PLAN_INCLUDE,
        orderBy: { createdAt: 'desc' },
      });
      const users = await this.userNames(tx, plans);
      return {
        can: { start: access.manage },
        plans: plans.map((p) => this.present(p, users, access, auth.user.id)),
      };
    });
  }

  /** Open onboarding tasks given to me, soonest first. */
  async myTasks(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const tasks = await tx.onboardingTask.findMany({
        where: { assigneeUserId: auth.user.id, status: 'OPEN', plan: { status: 'ACTIVE' } },
        include: { plan: { include: { employee: { select: PLAN_INCLUDE.employee.select } } } },
        orderBy: [{ dueDate: 'asc' }, { position: 'asc' }],
        take: 200,
      });
      return tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        assignee: t.assignee,
        dueDate: iso(t.dueDate),
        status: t.status,
        planId: t.planId,
        employee: { id: t.plan.employee.id, name: displayName(t.plan.employee) },
        forMe: t.plan.employee.membershipId === tenant.membershipId,
      }));
    });
  }

  async updateTask(
    tenant: TenantContext,
    auth: AuthContext,
    taskId: string,
    input: z.output<typeof completeTaskSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const task = await tx.onboardingTask.findUnique({
        where: { id: taskId },
        include: { plan: { include: PLAN_INCLUDE } },
      });
      if (!task) throw new NotFoundError('Task');
      const access = await this.planAccess(tx, tenant, task.plan.employee);
      if (!access.manage && task.assigneeUserId !== auth.user.id) {
        if (access.any) throw new ForbiddenError();
        throw new NotFoundError('Task');
      }
      if (task.plan.status !== 'ACTIVE') {
        throw new AppError('ONBOARDING_CLOSED', `This onboarding is ${task.plan.status.toLowerCase()}`, 409);
      }
      if (input.status === 'SKIPPED' && !access.manage) {
        throw new AppError('FORBIDDEN', 'Only HR can skip a task', 403);
      }
      await tx.onboardingTask.update({
        where: { id: taskId },
        data:
          input.status === 'OPEN'
            ? { status: 'OPEN', completedAt: null, completedByUserId: null, note: input.note ?? null }
            : {
                status: input.status,
                completedAt: new Date(),
                completedByUserId: auth.user.id,
                note: input.note ?? null,
              },
      });
      const open = await tx.onboardingTask.count({ where: { planId: task.planId, status: 'OPEN' } });
      if (open === 0) {
        await tx.onboardingPlan.update({
          where: { id: task.planId },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
      }
      await this.recruitment.record(
        tx,
        tenant,
        auth,
        `onboarding.task.${input.status.toLowerCase()}`,
        'onboarding_task',
        taskId,
        meta,
      );
      return this.viewPlan(tx, tenant, auth, task.planId);
    });
  }

  async cancel(tenant: TenantContext, auth: AuthContext, planId: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const p = await tx.onboardingPlan.findUnique({ where: { id: planId }, include: PLAN_INCLUDE });
      if (!p) throw new NotFoundError('Onboarding');
      const access = await this.planAccess(tx, tenant, p.employee);
      if (!access.manage) throw access.any ? new ForbiddenError() : new NotFoundError('Onboarding');
      if (p.status !== 'ACTIVE')
        throw new AppError('ONBOARDING_CLOSED', `This onboarding is ${p.status.toLowerCase()}`, 409);
      await tx.onboardingPlan.update({ where: { id: planId }, data: { status: 'CANCELLED' } });
      await this.recruitment.record(tx, tenant, auth, 'onboarding.cancel', 'onboarding_plan', planId, meta);
      return this.viewPlan(tx, tenant, auth, planId);
    });
  }
}
