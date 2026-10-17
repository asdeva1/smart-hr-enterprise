import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { ApprovalRequest, Prisma, TenantTransaction } from '@smart-hr/database';
import { AppError, NotFoundError, type ScopeRef } from '@smart-hr/shared';
import { employeeLifecycleSchema } from '@smart-hr/validation';
import { ApprovalSubjectRegistry } from '../approvals/approval-subjects.js';
import { ApprovalEngine } from '../approvals/approval.engine.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { ConfigurationService } from '../tenant/configuration.service.js';
import {
  displayName,
  EMPLOYEE_SELECT,
  EmployeesService,
  present,
  type EmployeeRecord,
  type Lifecycle,
} from './employees.service.js';
import { OrgIndex } from './org-index.js';

export const CHANGE_SUBJECT = 'employee_change';

const ACTION_LABEL: Record<Lifecycle['action'], string> = {
  transfer: 'Transfer',
  promotion: 'Promotion',
  change_manager: 'Manager change',
  notice: 'Notice',
  withdraw_notice: 'Notice withdrawn',
  exit: 'Exit',
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

function scopeOf(e: EmployeeRecord): ScopeRef {
  if (e.departmentId) return { type: 'DEPARTMENT', id: e.departmentId };
  if (e.branchId) return { type: 'BRANCH', id: e.branchId };
  return { type: 'COMPANY', id: e.companyId };
}

/**
 * Employment changes (promotion, transfer, manager change, notice, exit). When the organisation's
 * "Employment changes" setting asks for approval, a change is stored and sent through the approval engine;
 * it is checked again and applied only when approved, so the history never shows a change that didn't
 * happen. Otherwise it is applied straight away.
 */
@Injectable()
export class EmployeeChangesService implements OnModuleInit {
  constructor(
    private readonly employees: EmployeesService,
    private readonly configuration: ConfigurationService,
    private readonly engine: ApprovalEngine,
    private readonly subjects: ApprovalSubjectRegistry,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    const status =
      (to: 'REJECTED' | 'RETURNED' | 'CANCELLED' | 'PENDING') =>
      async (tx: TenantTransaction, request: ApprovalRequest, comment?: string | null) => {
        await tx.employeeChangeRequest.update({
          where: { id: request.subjectId },
          data: {
            status: to,
            decisionNote: comment ?? null,
            decidedAt: to === 'PENDING' ? null : new Date(),
          },
        });
      };
    this.subjects.register(CHANGE_SUBJECT, {
      onApproved: (tx, request) => this.applyApproved(tx, request),
      onRejected: status('REJECTED'),
      onReturned: status('RETURNED'),
      onCancelled: status('CANCELLED'),
      onResubmitted: status('PENDING'),
      link: (request) => `/employees/changes/${request.subjectId}`,
    });
  }

  /** The lifecycle route: apply now, or send for approval when the organisation asks for it. */
  async submit(tenant: TenantContext, auth: AuthContext, id: string, input: Lifecycle, meta: RequestMeta) {
    const mode = await this.employees.run(
      tenant,
      auth,
      async (tx) => (await this.configuration.effective(tx)).employment_changes,
    );
    if (mode === 'DIRECT') return this.employees.lifecycle(tenant, auth, id, input, meta);

    return this.employees.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const e = await this.employees.load(tx, tenant, org, id, 'employees.lifecycle');
      // One open change per employee, so approvers never decide on changes that contradict each other.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`employee-change:${id}`}))`;
      const open = await tx.employeeChangeRequest.findFirst({
        where: { employeeId: id, status: { in: ['PENDING', 'RETURNED'] } },
        select: { action: true },
      });
      if (open) {
        throw new AppError(
          'CHANGE_PENDING',
          `A ${ACTION_LABEL[open.action as Lifecycle['action']].toLowerCase()} for this employee is waiting for approval. Withdraw it before asking for another change.`,
          409,
        );
      }
      if (e.version !== input.version) {
        throw new AppError(
          'STALE_RECORD',
          'Someone else changed this employee since you opened it. Reload to see their changes, then try again.',
          409,
        );
      }
      const prepared = await this.employees.prepareLifecycle(tx, tenant.permissions, org, e, input);
      const change = await tx.employeeChangeRequest.create({
        data: {
          tenantId: tenant.id,
          employeeId: id,
          action: input.action,
          payload: input,
          changes: prepared.changes as Prisma.InputJsonValue,
          effectiveDate: prepared.effective,
          note: input.note ?? null,
          requestedByUserId: auth.user.id,
        },
      });
      const approval = await this.engine.submit(
        tx,
        {
          tenantId: tenant.id,
          membershipId: tenant.membershipId,
          userId: auth.user.id,
          displayName: auth.user.displayName,
        },
        {
          subjectType: CHANGE_SUBJECT,
          subjectId: change.id,
          title: `${ACTION_LABEL[input.action]}: ${displayName(e)}, from ${iso(prepared.effective)}`,
          scope: scopeOf(e),
          subjectEmployeeId: e.id,
        },
        meta,
      );
      await tx.employeeChangeRequest.update({
        where: { id: change.id },
        data: { approvalRequestId: approval.id },
      });
      await this.audit.recordInTransaction(
        tx,
        {
          action: `employee.${input.action}.request`,
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'employee',
          targetId: id,
          metadata: {
            changeId: change.id,
            fields: Object.keys(prepared.changes),
            effectiveDate: iso(prepared.effective),
          },
        },
        meta,
      );
      return { ...present(e), pendingChange: await this.view(tx, change.id) };
    });
  }

  /**
   * Approval: checks the change again against the employee as they are now and applies it. If it can no
   * longer be made (say they have since left), the approval is refused with the reason, and nothing changes.
   */
  private async applyApproved(tx: TenantTransaction, request: ApprovalRequest) {
    const change = await tx.employeeChangeRequest.findUniqueOrThrow({ where: { id: request.subjectId } });
    const input = employeeLifecycleSchema.parse(change.payload);
    const e = await tx.employee.findUniqueOrThrow({
      where: { id: change.employeeId },
      select: EMPLOYEE_SELECT,
    });
    const org = await OrgIndex.load(tx, change.tenantId);
    let prepared;
    try {
      prepared = await this.employees.prepareLifecycle(tx, null, org, e, input);
    } catch (error) {
      if (error instanceof AppError) {
        throw new AppError(
          'CHANGE_NO_LONGER_POSSIBLE',
          `This change can no longer be made: ${error.message}`,
          409,
        );
      }
      throw error;
    }
    await this.employees.applyLifecycle(
      tx,
      change.tenantId,
      e.id,
      prepared,
      null,
      change.note,
      change.requestedByUserId,
    );
    await tx.employeeChangeRequest.update({
      where: { id: change.id },
      data: { status: 'APPROVED', decidedAt: new Date() },
    });
  }

  private async view(tx: TenantTransaction, id: string) {
    const c = await tx.employeeChangeRequest.findUniqueOrThrow({
      where: { id },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, preferredName: true, employeeCode: true },
        },
      },
    });
    const approval = c.approvalRequestId
      ? await tx.approvalRequest.findUnique({
          where: { id: c.approvalRequestId },
          select: { id: true, status: true },
        })
      : null;
    return {
      id: c.id,
      employee: { id: c.employee.id, name: displayName(c.employee), employeeCode: c.employee.employeeCode },
      action: c.action,
      actionLabel: ACTION_LABEL[c.action as Lifecycle['action']] ?? c.action,
      changes: c.changes as Record<string, { from: unknown; to: unknown }>,
      effectiveDate: iso(c.effectiveDate),
      note: c.note,
      status: c.status,
      decisionNote: c.decisionNote,
      decidedAt: c.decidedAt,
      createdAt: c.createdAt,
      requestedByUserId: c.requestedByUserId,
      approvalRequest: approval,
    };
  }

  /** One change: approvers assigned to it, or anyone who may see the employee's record. */
  async get(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.employees.run(tenant, auth, async (tx) => {
      const c = await tx.employeeChangeRequest.findUnique({ where: { id }, select: { employeeId: true } });
      if (!c) throw new NotFoundError('Change');
      const assigned = await tx.approvalTask.count({
        where: {
          request: { subjectType: CHANGE_SUBJECT, subjectId: id },
          assigneeMembershipId: tenant.membershipId,
        },
      });
      if (!assigned)
        await this.employees.load(
          tx,
          tenant,
          await OrgIndex.load(tx, tenant.id),
          c.employeeId,
          'employees.view',
        );
      return this.view(tx, id);
    });
  }

  /** Changes for one employee, newest first (open ones show on their page). */
  async forEmployee(tenant: TenantContext, auth: AuthContext, employeeId: string) {
    return this.employees.run(tenant, auth, async (tx) => {
      await this.employees.load(tx, tenant, await OrgIndex.load(tx, tenant.id), employeeId, 'employees.view');
      const rows = await tx.employeeChangeRequest.findMany({
        where: { employeeId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true },
      });
      const views = [];
      for (const r of rows) views.push(await this.view(tx, r.id));
      return views;
    });
  }

  /** Whoever asked for a change can withdraw it while it is open. */
  async cancel(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.employees.run(tenant, auth, async (tx) => {
      const c = await tx.employeeChangeRequest.findUnique({ where: { id } });
      if (!c || c.requestedByUserId !== auth.user.id || !c.approvalRequestId)
        throw new NotFoundError('Change');
      if (c.status !== 'PENDING' && c.status !== 'RETURNED') {
        throw new AppError('CHANGE_CLOSED', 'Only open changes can be withdrawn', 409);
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
