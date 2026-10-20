import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  isUniqueViolation,
  type ApprovalRequest,
  type Prisma,
  type TenantTransaction,
} from '@smart-hr/database';
import { AppError, ForbiddenError, NotFoundError } from '@smart-hr/shared';
import type {
  expenseCategorySchema,
  expenseClaimSchema,
  expenseListQuerySchema,
  payExpenseClaimSchema,
  updateExpenseCategorySchema,
  updateExpenseClaimSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { ApprovalSubjectRegistry } from '../approvals/approval-subjects.js';
import { ApprovalEngine } from '../approvals/approval.engine.js';
import { AuditService } from '../audit/audit.service.js';
import {
  AttendanceService,
  scopeOfEmployee,
  toDate,
  type AttendanceEmployee,
} from '../attendance/attendance.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { displayName } from '../employees/employees.service.js';
import { OrgIndex } from '../employees/org-index.js';

export const EXPENSE_SUBJECT = 'expense_claim';

const num = (d: Prisma.Decimal | number | null) => (d === null ? null : Number(d));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const cents = (n: number) => Math.round(n * 100);

function invalid(path: string, message: string) {
  return new AppError('VALIDATION_FAILED', message, 400, [{ path, message }]);
}

/**
 * Expense claims: an employee lists what they spent, sends it for approval, and the finance team marks it
 * paid. Lines can be changed only while the claim is a draft (including after it was sent back).
 */
@Injectable()
export class ExpensesService implements OnModuleInit {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly engine: ApprovalEngine,
    private readonly subjects: ApprovalSubjectRegistry,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    const to =
      (status: 'REJECTED' | 'DRAFT' | 'CANCELLED' | 'PENDING_APPROVAL') =>
      async (tx: TenantTransaction, request: ApprovalRequest, comment?: string | null) => {
        await tx.expenseClaim.update({
          where: { id: request.subjectId },
          data: {
            status,
            decisionNote: comment ?? null,
            decidedAt: status === 'PENDING_APPROVAL' || status === 'DRAFT' ? null : new Date(),
          },
        });
      };
    this.subjects.register(EXPENSE_SUBJECT, {
      onApproved: async (tx, request) => {
        await tx.expenseClaim.update({
          where: { id: request.subjectId },
          data: { status: 'APPROVED', decidedAt: new Date() },
        });
      },
      onRejected: to('REJECTED'),
      onReturned: to('DRAFT'),
      onCancelled: to('CANCELLED'),
      onResubmitted: to('PENDING_APPROVAL'),
      link: (request) => `/expenses/${request.subjectId}`,
    });
  }

  run<T>(tenant: TenantContext, auth: AuthContext, work: (tx: TenantTransaction) => Promise<T>) {
    return this.attendance.run(tenant, auth, work);
  }

  private actor(tenant: TenantContext, auth: AuthContext) {
    return {
      tenantId: tenant.id,
      membershipId: tenant.membershipId,
      userId: auth.user.id,
      displayName: auth.user.displayName,
    };
  }

  // ---- Categories --------------------------------------------------------------------------------

  private categoryView(c: {
    id: string;
    code: string;
    name: string;
    requiresReceipt: boolean;
    maxAmount: Prisma.Decimal | null;
    status: string;
  }) {
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      requiresReceipt: c.requiresReceipt,
      maxAmount: num(c.maxAmount),
      status: c.status,
    };
  }

  categories(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const rows = await tx.expenseCategory.findMany({ orderBy: { name: 'asc' } });
      return rows.map((c) => this.categoryView(c));
    });
  }

  createCategory(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof expenseCategorySchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      try {
        const c = await tx.expenseCategory.create({
          data: {
            tenantId: tenant.id,
            code: input.code.toUpperCase(),
            name: input.name,
            requiresReceipt: input.requiresReceipt,
            maxAmount: input.maxAmount ?? null,
          },
        });
        await this.record(tx, tenant, auth, 'expenses.category.create', 'expense_category', c.id, meta);
        return this.categoryView(c);
      } catch (error) {
        if (isUniqueViolation(error)) throw invalid('code', 'That code is already used');
        throw error;
      }
    });
  }

  updateCategory(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateExpenseCategorySchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const existing = await tx.expenseCategory.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError('Expense category');
      const data: Prisma.ExpenseCategoryUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.requiresReceipt !== undefined) data.requiresReceipt = input.requiresReceipt;
      if (input.maxAmount !== undefined) data.maxAmount = input.maxAmount;
      if (input.status !== undefined) data.status = input.status;
      const c = await tx.expenseCategory.update({ where: { id }, data });
      await this.record(tx, tenant, auth, 'expenses.category.update', 'expense_category', id, meta);
      return this.categoryView(c);
    });
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

  // ---- Claims ------------------------------------------------------------------------------------

  private async view(tx: TenantTransaction, id: string) {
    const c = await tx.expenseClaim.findUnique({
      where: { id },
      include: {
        lines: {
          orderBy: { position: 'asc' },
          include: { category: { select: { code: true, name: true } } },
        },
        employee: {
          select: { id: true, employeeCode: true, firstName: true, lastName: true, preferredName: true },
        },
      },
    });
    if (!c) throw new NotFoundError('Expense claim');
    const approval = c.approvalRequestId
      ? await tx.approvalRequest.findUnique({
          where: { id: c.approvalRequestId },
          select: { id: true, status: true, currentStage: true, round: true },
        })
      : null;
    return {
      id: c.id,
      number: c.number,
      title: c.title,
      status: c.status,
      total: num(c.total),
      currency: c.currency,
      employee: {
        id: c.employee.id,
        code: c.employee.employeeCode,
        name: displayName(c.employee),
      },
      submittedAt: c.submittedAt?.toISOString() ?? null,
      decidedAt: c.decidedAt?.toISOString() ?? null,
      decisionNote: c.decisionNote,
      paidAt: c.paidAt?.toISOString() ?? null,
      paymentReference: c.paymentReference,
      createdAt: c.createdAt.toISOString(),
      approvalRequest: approval,
      lines: c.lines.map((l) => ({
        id: l.id,
        position: l.position,
        date: iso(l.date),
        categoryId: l.categoryId,
        category: l.category.name,
        description: l.description,
        amount: num(l.amount),
        receiptNumber: l.receiptNumber,
      })),
    };
  }

  /** Whether the caller may see this claim: their own, one in their reach, or one waiting on them. */
  private async canSee(
    tx: TenantTransaction,
    tenant: TenantContext,
    org: OrgIndex,
    claim: { employeeId: string; approvalRequestId: string | null },
    e: AttendanceEmployee,
  ) {
    if (e.membershipId === tenant.membershipId) return true;
    if (tenant.permissions.allows('expenses.view', org.scopesOf(e))) return true;
    if (claim.approvalRequestId) {
      const assigned = await tx.approvalTask.count({
        where: { requestId: claim.approvalRequestId, assignedMembershipId: tenant.membershipId },
      });
      if (assigned > 0) return true;
    }
    return false;
  }

  async list(tenant: TenantContext, auth: AuthContext, q: z.output<typeof expenseListQuerySchema>) {
    return this.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const where: Prisma.ExpenseClaimWhereInput = q.status ? { status: q.status } : {};
      if (q.scope === 'mine') {
        const me = await this.attendance.self(tx, tenant);
        if (!me) return [];
        where.employeeId = me.id;
      }
      const rows = await tx.expenseClaim.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 500,
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              preferredName: true,
              companyId: true,
              branchId: true,
              departmentId: true,
              membershipId: true,
            },
          },
        },
      });
      return rows
        .filter(
          (c) =>
            q.scope === 'mine' ||
            c.employee.membershipId === tenant.membershipId ||
            tenant.permissions.allows('expenses.view', org.scopesOf(c.employee)),
        )
        .map((c) => ({
          id: c.id,
          number: c.number,
          title: c.title,
          status: c.status,
          total: num(c.total),
          currency: c.currency,
          employee: { id: c.employee.id, code: c.employee.employeeCode, name: displayName(c.employee) },
          submittedAt: c.submittedAt?.toISOString() ?? null,
          createdAt: c.createdAt.toISOString(),
        }));
    });
  }

  async get(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, async (tx) => {
      const claim = await tx.expenseClaim.findUnique({ where: { id } });
      if (!claim) throw new NotFoundError('Expense claim');
      const org = await OrgIndex.load(tx, tenant.id);
      const e = await tx.employee.findUniqueOrThrow({
        where: { id: claim.employeeId },
        select: { id: true, membershipId: true, companyId: true, branchId: true, departmentId: true },
      });
      if (!(await this.canSee(tx, tenant, org, claim, e as AttendanceEmployee))) {
        throw new NotFoundError('Expense claim');
      }
      return this.view(tx, id);
    });
  }

  /** Checks every line against its category and builds the rows to store. */
  private async prepareLines(
    tx: TenantTransaction,
    lines: z.output<typeof expenseClaimSchema>['lines'],
    today: Date,
  ) {
    const ids = [...new Set(lines.map((l) => l.categoryId))];
    const categories = new Map(
      (await tx.expenseCategory.findMany({ where: { id: { in: ids } } })).map((c) => [c.id, c]),
    );
    let total = 0;
    const rows = lines.map((l, i) => {
      const path = `lines.${i}`;
      const category = categories.get(l.categoryId);
      if (!category || category.status !== 'ACTIVE')
        throw invalid(`${path}.categoryId`, 'Choose an active category');
      if (toDate(l.date).getTime() > today.getTime() + 86_400_000) {
        throw invalid(`${path}.date`, 'The date can’t be in the future');
      }
      if (category.maxAmount !== null && cents(l.amount) > cents(Number(category.maxAmount))) {
        throw invalid(
          `${path}.amount`,
          `${category.name} is limited to ${Number(category.maxAmount)} per expense`,
        );
      }
      if (category.requiresReceipt && !l.receiptNumber) {
        throw invalid(`${path}.receiptNumber`, `${category.name} needs a receipt or bill number`);
      }
      total += cents(l.amount);
      return {
        position: i + 1,
        date: toDate(l.date),
        categoryId: l.categoryId,
        description: l.description,
        amount: l.amount,
        receiptNumber: l.receiptNumber ?? null,
      };
    });
    return { rows, total: total / 100 };
  }

  /** Who a claim is for: the caller by default, or another employee the caller manages expenses for. */
  private async subjectOf(tx: TenantTransaction, tenant: TenantContext, employeeId?: string) {
    const org = await OrgIndex.load(tx, tenant.id);
    const me = await this.attendance.self(tx, tenant);
    if (!employeeId || employeeId === me?.id) {
      return { e: await this.attendance.requireSelf(tx, tenant), self: true };
    }
    const e = await this.attendance.loadFor(tx, tenant, org, employeeId, 'expenses.manage', 'expenses.view');
    return { e, self: false };
  }

  async create(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof expenseClaimSchema>,
    meta: RequestMeta,
    now = new Date(),
  ) {
    return this.run(tenant, auth, async (tx) => {
      const { e } = await this.subjectOf(tx, tenant, input.employeeId);
      const company = await tx.company.findUniqueOrThrow({
        where: { id: e.companyId },
        select: { baseCurrency: true },
      });
      const { rows, total } = await this.prepareLines(tx, input.lines, now);
      const claim = await tx.expenseClaim.create({
        data: {
          tenantId: tenant.id,
          employeeId: e.id,
          title: input.title,
          total,
          currency: company.baseCurrency,
          createdByUserId: auth.user.id,
        },
      });
      await tx.expenseLine.createMany({
        data: rows.map((r) => ({ ...r, tenantId: tenant.id, claimId: claim.id })),
      });
      await this.record(tx, tenant, auth, 'expenses.claim.create', 'expense_claim', claim.id, meta, {
        total,
      });
      return this.view(tx, claim.id);
    });
  }

  /** Loads a claim the caller may change: the claimant or its creator, or an expense manager. */
  private async editable(tx: TenantTransaction, tenant: TenantContext, auth: AuthContext, id: string) {
    const claim = await tx.expenseClaim.findUnique({ where: { id } });
    if (!claim) throw new NotFoundError('Expense claim');
    const org = await OrgIndex.load(tx, tenant.id);
    const e = await this.attendance.loadFor(
      tx,
      tenant,
      org,
      claim.employeeId,
      'expenses.view',
      'expenses.view',
    );
    const mine = e.membershipId === tenant.membershipId || claim.createdByUserId === auth.user.id;
    if (!mine && !tenant.permissions.allows('expenses.manage', org.scopesOf(e))) throw new ForbiddenError();
    return { claim, e };
  }

  async update(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateExpenseClaimSchema>,
    meta: RequestMeta,
    now = new Date(),
  ) {
    return this.run(tenant, auth, async (tx) => {
      const { claim } = await this.editable(tx, tenant, auth, id);
      if (claim.status !== 'DRAFT') {
        throw new AppError('CLAIM_LOCKED', 'Only a draft claim can be changed', 409);
      }
      const { rows, total } = await this.prepareLines(tx, input.lines, now);
      await tx.expenseLine.deleteMany({ where: { claimId: id } });
      await tx.expenseClaim.update({
        where: { id },
        data: {
          title: input.title,
          total,
        },
      });
      await tx.expenseLine.createMany({
        data: rows.map((r) => ({ ...r, tenantId: tenant.id, claimId: id })),
      });
      await this.record(tx, tenant, auth, 'expenses.claim.update', 'expense_claim', id, meta, { total });
      return this.view(tx, id);
    });
  }

  async submit(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const { claim, e } = await this.editable(tx, tenant, auth, id);
      if (claim.status !== 'DRAFT') {
        throw new AppError('CLAIM_LOCKED', 'This claim has already been sent', 409);
      }
      const lines = await tx.expenseLine.count({ where: { claimId: id } });
      if (lines === 0) throw invalid('lines', 'Add at least one expense');
      const actor = this.actor(tenant, auth);

      if (claim.approvalRequestId) {
        // Sent back earlier: round it again under the same request.
        await tx.expenseClaim.update({ where: { id }, data: { submittedAt: new Date() } });
        await this.engine.resubmit(tx, actor, claim.approvalRequestId, meta);
      } else {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`expense-number:${tenant.id}`}))`;
        const last = await tx.expenseClaim.findFirst({
          where: { number: { startsWith: 'EXP-' } },
          orderBy: { number: 'desc' },
          select: { number: true },
        });
        const next = (last?.number ? Number(last.number.slice(4)) : 0) + 1;
        const number = `EXP-${String(next).padStart(6, '0')}`;
        await tx.expenseClaim.update({
          where: { id },
          data: { number, status: 'PENDING_APPROVAL', submittedAt: new Date(), decisionNote: null },
        });
        const approval = await this.engine.submit(
          tx,
          actor,
          {
            subjectType: EXPENSE_SUBJECT,
            subjectId: id,
            title: `${number}: ${claim.title} — ${displayName(e)}`,
            amount: claim.total.toFixed(2),
            currency: claim.currency,
            scope: scopeOfEmployee(tenant.id, e),
            subjectEmployeeId: e.id,
          },
          meta,
        );
        await tx.expenseClaim.update({ where: { id }, data: { approvalRequestId: approval.id } });
      }
      await this.record(tx, tenant, auth, 'expenses.claim.submit', 'expense_claim', id, meta, {
        total: Number(claim.total),
      });
      return this.view(tx, id);
    });
  }

  async cancel(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const { claim } = await this.editable(tx, tenant, auth, id);
      if (claim.status === 'DRAFT' && !claim.approvalRequestId) {
        await tx.expenseClaim.update({ where: { id }, data: { status: 'CANCELLED', decidedAt: new Date() } });
      } else if (claim.status === 'DRAFT' || claim.status === 'PENDING_APPROVAL') {
        if (!claim.approvalRequestId) throw new NotFoundError('Expense claim');
        await this.engine.cancel(tx, this.actor(tenant, auth), claim.approvalRequestId, meta);
      } else {
        throw new AppError('CLAIM_LOCKED', 'Only a claim that is still open can be withdrawn', 409);
      }
      await this.record(tx, tenant, auth, 'expenses.claim.cancel', 'expense_claim', id, meta);
      return this.view(tx, id);
    });
  }

  /** Finance marks an approved claim as paid, with the bank or cash reference. */
  async markPaid(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof payExpenseClaimSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const claim = await tx.expenseClaim.findUnique({ where: { id } });
      if (!claim) throw new NotFoundError('Expense claim');
      const org = await OrgIndex.load(tx, tenant.id);
      const e = await this.attendance.loadFor(
        tx,
        tenant,
        org,
        claim.employeeId,
        'expenses.view',
        'expenses.view',
      );
      if (!tenant.permissions.allows('expenses.manage', org.scopesOf(e))) throw new ForbiddenError();
      if (claim.status !== 'APPROVED') {
        throw new AppError('CLAIM_NOT_APPROVED', 'Only an approved claim can be marked as paid', 409);
      }
      await tx.expenseClaim.update({
        where: { id },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          paymentReference: input.reference,
          paidByUserId: auth.user.id,
        },
      });
      await this.record(tx, tenant, auth, 'expenses.claim.pay', 'expense_claim', id, meta, {
        total: Number(claim.total),
      });
      return this.view(tx, id);
    });
  }
}
