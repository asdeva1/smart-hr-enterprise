import { Inject, Injectable } from '@nestjs/common';
import {
  createNotifications,
  Prisma,
  type ApprovalRequest,
  type ScopeType,
  type TenantTransaction,
} from '@smart-hr/database';
import {
  APPROVAL_SUBJECTS,
  AppError,
  defaultApproverIsManager,
  isApprovalSubject,
  NOTIFICATION_CATEGORIES,
  notifiesSubject,
  NotFoundError,
  type ScopeRef,
} from '@smart-hr/shared';
import {
  approvalPolicyDefinitionSchema,
  type ApprovalPolicyDefinition,
  type ApproverRule,
} from '@smart-hr/validation';
import { AuditService } from '../audit/audit.service.js';
import type { RequestMeta } from '../common/request-context.js';
import type { ApiEnv } from '../config/env.js';
import { API_ENV } from '../infra/tokens.js';
import { RbacService } from '../rbac/rbac.service.js';
import { ApprovalSubjectRegistry } from './approval-subjects.js';

/** The person acting, as verified by the auth guard. */
export interface ApprovalActor {
  tenantId: string;
  membershipId: string;
  userId: string;
  displayName: string;
}

export interface SubmitInput {
  subjectType: string;
  subjectId: string;
  title: string;
  /** Exact decimal string; drives amount-threshold stages. */
  amount?: string;
  currency?: string;
  /** Where the subject sits in the organisation; approvers are resolved for this scope. */
  scope: ScopeRef;
  /** The employee the request is about, so "reporting manager" rules can find their manager. */
  subjectEmployeeId?: string;
}

export type Decision = 'APPROVE' | 'REJECT' | 'RETURN';

const OWNERS_POLICY: ApprovalPolicyDefinition = {
  stages: [{ name: 'Organisation owner', mode: 'ANY', approvers: [{ type: 'OWNERS' }] }],
  distinctApprovers: true,
};

const MANAGER_POLICY: ApprovalPolicyDefinition = {
  stages: [{ name: 'Reporting manager', mode: 'ANY', approvers: [{ type: 'MANAGER', levels: 1 }] }],
  distinctApprovers: true,
};

function subjectLabel(subjectType: string): string {
  return isApprovalSubject(subjectType) ? APPROVAL_SUBJECTS[subjectType].label : subjectType;
}

/**
 * The universal approval engine. Every method runs inside the caller's tenant transaction, so a module's
 * own change (e.g. creating a leave request) and its approval commit together.
 *
 * Separation of duties: a requester is never assigned to their own request, and with `distinctApprovers`
 * nobody approves two stages of the same round. Delegations are applied when tasks are created.
 */
@Injectable()
export class ApprovalEngine {
  constructor(
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly subjects: ApprovalSubjectRegistry,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /**
   * The active policy for a subject type, creating the default on first use: the reporting manager for
   * requests about one employee (leave, attendance corrections), the owners for everything else.
   */
  async activePolicy(tx: TenantTransaction, tenantId: string, subjectType: string) {
    const active = await tx.approvalPolicy.findFirst({
      where: { subjectType, isActive: true },
      orderBy: { version: 'desc' },
    });
    if (active) return active;
    const latest = await tx.approvalPolicy.findFirst({
      where: { subjectType },
      orderBy: { version: 'desc' },
    });
    return tx.approvalPolicy.create({
      data: {
        tenantId,
        subjectType,
        version: (latest?.version ?? 0) + 1,
        ...(defaultApproverIsManager(subjectType)
          ? { name: 'Default — reporting manager approves', definition: MANAGER_POLICY }
          : { name: 'Default — organisation owners approve', definition: OWNERS_POLICY }),
      },
    });
  }

  async submit(tx: TenantTransaction, actor: ApprovalActor, input: SubmitInput, meta: RequestMeta) {
    if (!isApprovalSubject(input.subjectType)) {
      throw new AppError('UNKNOWN_SUBJECT', `Unknown approval subject: ${input.subjectType}`, 400);
    }
    const policy = await this.activePolicy(tx, actor.tenantId, input.subjectType);
    const request = await tx.approvalRequest.create({
      data: {
        tenantId: actor.tenantId,
        policyId: policy.id,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        title: input.title.slice(0, 200),
        amount: input.amount ?? null,
        currency: input.currency ?? null,
        scopeType: input.scope.type,
        scopeId: input.scope.id,
        requestedByMembershipId: actor.membershipId,
        subjectEmployeeId: input.subjectEmployeeId ?? null,
      },
    });
    await this.audit.recordInTransaction(
      tx,
      {
        action: 'approval.request.submit',
        outcome: 'SUCCESS',
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        targetType: 'approval_request',
        targetId: request.id,
        metadata: { subjectType: input.subjectType, policyVersion: policy.version },
      },
      meta,
    );
    await this.notifySubject(tx, request, `${actor.displayName} asked for this for you`, null);
    return this.advance(tx, request, 0, new Set());
  }

  /**
   * Tells the employee a request is about, when someone else asked for it (HR recording leave for them, say)
   * and when it is decided. Only for request types about one person's own time (leave, corrections).
   */
  private async notifySubject(
    tx: TenantTransaction,
    request: ApprovalRequest,
    headline: string,
    outcome: string | null,
  ) {
    if (!request.subjectEmployeeId || !notifiesSubject(request.subjectType)) return;
    const subject = await tx.employee.findUnique({
      where: { id: request.subjectEmployeeId },
      select: { membership: { select: { id: true, userId: true, status: true } } },
    });
    const m = subject?.membership;
    // Nobody to tell, or they asked for it themselves (they hear as the requester).
    if (!m || m.status !== 'ACTIVE' || m.id === request.requestedByMembershipId) return;
    await createNotifications(tx, request.tenantId, {
      recipientUserIds: [m.userId],
      category: 'request.about_me',
      emailDefault: NOTIFICATION_CATEGORIES['request.about_me'].emailDefault,
      title: outcome ? `A request for you was ${outcome}` : headline,
      body: request.title,
      link: this.link(request),
      email: {
        subject: outcome ? `${request.title}: ${outcome}` : `${headline}: ${request.title}`,
        text: `${outcome ? `${request.title} was ${outcome}.` : `${headline}:\n\n  ${request.title}`}\n\nDetails: ${this.emailLink(request)}`,
      },
    });
  }

  /** Records one approver's decision and moves the request on. */
  async decide(
    tx: TenantTransaction,
    actor: ApprovalActor,
    taskId: string,
    decision: Decision,
    comment: string | null,
    meta: RequestMeta,
  ) {
    const found = await tx.approvalTask.findUnique({ where: { id: taskId }, select: { requestId: true } });
    // Someone else's task looks exactly like a missing one.
    if (!found) throw new NotFoundError('Approval task');
    // Serialise decisions on one request, so "ALL must approve" stages can't double-complete.
    await tx.$queryRaw`SELECT 1 FROM approval_request WHERE id = ${found.requestId}::uuid FOR UPDATE`;

    const task = await tx.approvalTask.findUnique({ where: { id: taskId }, include: { request: true } });
    if (!task || task.assigneeMembershipId !== actor.membershipId) throw new NotFoundError('Approval task');
    if (task.status !== 'PENDING') {
      throw new AppError('TASK_ALREADY_DECIDED', 'This approval has already been decided', 409);
    }
    const request = task.request;
    if (request.status !== 'PENDING' || request.round !== task.round || request.currentStage !== task.stage) {
      throw new AppError('REQUEST_NOT_PENDING', 'This request is no longer waiting for this decision', 409);
    }
    if (request.requestedByMembershipId === actor.membershipId) {
      throw new AppError('SEPARATION_OF_DUTIES', 'You can’t decide your own request', 403);
    }

    const status = decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'RETURNED';
    await tx.approvalTask.update({
      where: { id: taskId },
      data: { status, actedByMembershipId: actor.membershipId, actedAt: new Date(), comment },
    });
    await this.audit.recordInTransaction(
      tx,
      {
        action: `approval.task.${decision.toLowerCase()}`,
        outcome: 'SUCCESS',
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        targetType: 'approval_request',
        targetId: request.id,
        metadata: { taskId, stage: task.stage, round: task.round },
      },
      meta,
    );

    const others = {
      requestId: request.id,
      round: task.round,
      stage: task.stage,
      status: 'PENDING' as const,
    };
    if (decision !== 'APPROVE') {
      await tx.approvalTask.updateMany({ where: others, data: { status: 'CANCELLED' } });
      const final = await tx.approvalRequest.update({
        where: { id: request.id },
        data: { status: decision === 'REJECT' ? 'REJECTED' : 'RETURNED', decidedAt: new Date() },
      });
      const handler = this.subjects.get(final.subjectType);
      if (decision === 'REJECT') await handler.onRejected?.(tx, final, comment);
      else await handler.onReturned?.(tx, final, comment);
      await this.notifyRequester(tx, final, decision === 'REJECT' ? 'rejected' : 'sent back', actor, comment);
      return final;
    }

    const definition = await this.definitionOf(tx, request);
    const stage = definition.stages[task.stage]!;
    if (stage.mode === 'ANY') {
      await tx.approvalTask.updateMany({ where: others, data: { status: 'SKIPPED' } });
    } else if ((await tx.approvalTask.count({ where: others })) > 0) {
      return request; // ALL: still waiting for the others.
    }
    const approvedSoFar = await tx.approvalTask.findMany({
      where: { requestId: request.id, round: task.round, status: 'APPROVED' },
      select: { actedByMembershipId: true },
    });
    return this.advance(
      tx,
      request,
      task.stage + 1,
      new Set(approvedSoFar.map((t) => t.actedByMembershipId!).filter(Boolean)),
    );
  }

  /** The requester withdraws a pending or returned request. */
  async cancel(tx: TenantTransaction, actor: ApprovalActor, requestId: string, meta: RequestMeta) {
    await tx.$queryRaw`SELECT 1 FROM approval_request WHERE id = ${requestId}::uuid FOR UPDATE`;
    const request = await tx.approvalRequest.findUnique({ where: { id: requestId } });
    if (!request || request.requestedByMembershipId !== actor.membershipId) {
      throw new NotFoundError('Approval request');
    }
    if (request.status !== 'PENDING' && request.status !== 'RETURNED') {
      throw new AppError('REQUEST_CLOSED', 'Only open requests can be withdrawn', 409);
    }
    await tx.approvalTask.updateMany({
      where: { requestId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    const final = await tx.approvalRequest.update({
      where: { id: requestId },
      data: { status: 'CANCELLED', decidedAt: new Date() },
    });
    await this.subjects.get(final.subjectType).onCancelled?.(tx, final);
    await this.audit.recordInTransaction(
      tx,
      {
        action: 'approval.request.cancel',
        outcome: 'SUCCESS',
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        targetType: 'approval_request',
        targetId: requestId,
      },
      meta,
    );
    return final;
  }

  /** Sends a returned request round again from the first stage, under the same policy version. */
  async resubmit(tx: TenantTransaction, actor: ApprovalActor, requestId: string, meta: RequestMeta) {
    await tx.$queryRaw`SELECT 1 FROM approval_request WHERE id = ${requestId}::uuid FOR UPDATE`;
    const request = await tx.approvalRequest.findUnique({ where: { id: requestId } });
    if (!request || request.requestedByMembershipId !== actor.membershipId) {
      throw new NotFoundError('Approval request');
    }
    if (request.status !== 'RETURNED') {
      throw new AppError('NOT_RETURNED', 'Only a request that was sent back can be resubmitted', 409);
    }
    const reopened = await tx.approvalRequest.update({
      where: { id: requestId },
      data: { status: 'PENDING', round: request.round + 1, currentStage: 0, decidedAt: null },
    });
    await this.audit.recordInTransaction(
      tx,
      {
        action: 'approval.request.resubmit',
        outcome: 'SUCCESS',
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        targetType: 'approval_request',
        targetId: requestId,
        metadata: { round: reopened.round },
      },
      meta,
    );
    await this.subjects.get(reopened.subjectType).onResubmitted?.(tx, reopened);
    return this.advance(tx, reopened, 0, new Set());
  }

  // ---------------------------------------------------------------------------------------------

  private async definitionOf(
    tx: TenantTransaction,
    request: ApprovalRequest,
  ): Promise<ApprovalPolicyDefinition> {
    const policy = await tx.approvalPolicy.findUniqueOrThrow({ where: { id: request.policyId } });
    return approvalPolicyDefinitionSchema.parse(policy.definition);
  }

  /**
   * Starts the first applicable stage at or after `fromStage`, or approves the request when none is left.
   * Stages whose amount threshold the request doesn't reach are skipped.
   */
  private async advance(
    tx: TenantTransaction,
    request: ApprovalRequest,
    fromStage: number,
    approvedSoFar: Set<string>,
  ): Promise<ApprovalRequest> {
    const definition = await this.definitionOf(tx, request);
    for (let index = fromStage; index < definition.stages.length; index++) {
      const stage = definition.stages[index]!;
      if (stage.minAmount !== undefined) {
        const amount = request.amount;
        if (amount === null || amount.lessThan(new Prisma.Decimal(stage.minAmount))) continue;
      }
      const exclude = new Set([request.requestedByMembershipId]);
      if (definition.distinctApprovers) for (const id of approvedSoFar) exclude.add(id);
      let assignees = await this.resolve(tx, request, stage.approvers, exclude);
      // Owners are the backstop when a rule finds nobody (e.g. a role nobody holds yet).
      if (assignees.size === 0) assignees = await this.resolve(tx, request, [{ type: 'OWNERS' }], exclude);
      if (assignees.size === 0 && definition.distinctApprovers) {
        assignees = await this.resolve(
          tx,
          request,
          [{ type: 'OWNERS' }],
          new Set([request.requestedByMembershipId]),
        );
      }
      if (assignees.size === 0) {
        throw new AppError(
          'NO_APPROVER',
          `Nobody can approve the “${stage.name}” stage. Ask an administrator to update the approval policy.`,
          409,
        );
      }

      const delegated = await this.applyDelegations(
        tx,
        [...assignees.keys()],
        request.requestedByMembershipId,
      );
      const dueAt = stage.dueInHours ? new Date(Date.now() + stage.dueInHours * 3_600_000) : null;
      await tx.approvalTask.createMany({
        data: delegated.map(({ assignee, from }) => ({
          tenantId: request.tenantId,
          requestId: request.id,
          round: request.round,
          stage: index,
          stageName: stage.name,
          assigneeMembershipId: assignee,
          delegatedFromMembershipId: from,
          dueAt,
        })),
      });
      const updated = await tx.approvalRequest.update({
        where: { id: request.id },
        data: { currentStage: index },
      });
      await this.notifyAssignees(
        tx,
        updated,
        delegated.map((d) => d.assignee),
      );
      return updated;
    }

    const approved = await tx.approvalRequest.update({
      where: { id: request.id },
      data: { status: 'APPROVED', decidedAt: new Date() },
    });
    await this.subjects.get(approved.subjectType).onApproved?.(tx, approved);
    await this.notifyRequester(tx, approved, 'approved', null, null);
    return approved;
  }

  /**
   * The sign-in membership of the manager `levels` steps up from the subject employee, if that person can
   * sign in. Nobody (and so the owners' backstop) when there is no subject employee, no manager that far up,
   * or the manager has no active sign-in.
   */
  private async managerOf(
    tx: TenantTransaction,
    employeeId: string | null,
    levels: number,
  ): Promise<string[]> {
    let current = employeeId;
    for (let step = 0; current && step < levels; step++) {
      const row = await tx.employee.findUnique({ where: { id: current }, select: { managerId: true } });
      current = row?.managerId ?? null;
    }
    if (!current || current === employeeId) return [];
    const manager = await tx.employee.findUnique({
      where: { id: current },
      select: {
        status: true,
        membership: { select: { id: true, status: true, user: { select: { status: true } } } },
      },
    });
    const m = manager?.membership;
    if (
      !manager ||
      manager.status === 'EXITED' ||
      !m ||
      m.status !== 'ACTIVE' ||
      m.user.status !== 'ACTIVE'
    ) {
      return [];
    }
    return [m.id];
  }

  /** Active members matching the rules at a scope covering the request, minus `exclude`. */
  private async resolve(
    tx: TenantTransaction,
    request: ApprovalRequest,
    rules: ApproverRule[],
    exclude: Set<string>,
  ): Promise<Map<string, true>> {
    const target = await this.rbac.scopesOf(tx, request.tenantId, {
      type: request.scopeType,
      id: request.scopeId,
    });
    const covers = (a: { scopeType: ScopeType; scopeId: string }) =>
      a.scopeType === 'TENANT'
        ? a.scopeId === request.tenantId
        : target.some((t) => t.type === a.scopeType && t.id === a.scopeId);
    const activeMember = { status: 'ACTIVE' as const, user: { status: 'ACTIVE' as const } };
    const found = new Map<string, true>();

    for (const rule of rules) {
      let ids: string[];
      if (rule.type === 'ROLE' || rule.type === 'PERMISSION') {
        const rows = await tx.roleAssignment.findMany({
          where: {
            membership: activeMember,
            ...(rule.type === 'ROLE'
              ? { roleId: rule.roleId }
              : { role: { permissions: { some: { permission: rule.permission } } } }),
          },
          select: { membershipId: true, scopeType: true, scopeId: true },
        });
        ids = rows.filter(covers).map((r) => r.membershipId);
      } else if (rule.type === 'MANAGER') {
        ids = await this.managerOf(tx, request.subjectEmployeeId, rule.levels);
      } else if (rule.type === 'MEMBER') {
        const m = await tx.tenantMembership.findFirst({
          where: { id: rule.membershipId, ...activeMember },
          select: { id: true },
        });
        ids = m ? [m.id] : [];
      } else {
        const owners = await tx.tenantMembership.findMany({
          where: { isTenantAdmin: true, ...activeMember },
          select: { id: true },
        });
        ids = owners.map((o) => o.id);
      }
      for (const id of ids) if (!exclude.has(id)) found.set(id, true);
    }
    return found;
  }

  /** Replaces approvers who are away with the person they delegated to (never the requester). */
  private async applyDelegations(tx: TenantTransaction, assignees: string[], requester: string) {
    const now = new Date();
    const delegations = await tx.approvalDelegation.findMany({
      where: {
        fromMembershipId: { in: assignees },
        revokedAt: null,
        startsAt: { lte: now },
        endsAt: { gt: now },
        to: { status: 'ACTIVE', user: { status: 'ACTIVE' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const byFrom = new Map<string, string>();
    for (const d of delegations)
      if (!byFrom.has(d.fromMembershipId)) byFrom.set(d.fromMembershipId, d.toMembershipId);

    const result = new Map<string, string | null>();
    for (const assignee of assignees) {
      const delegate = byFrom.get(assignee);
      if (delegate && delegate !== requester) {
        if (!result.has(delegate)) result.set(delegate, assignee);
      } else if (!result.has(assignee)) {
        result.set(assignee, null);
      }
    }
    return [...result.entries()].map(([assignee, from]) => ({ assignee, from }));
  }

  private link(request: ApprovalRequest): string {
    return `/approvals/${request.id}`;
  }

  /** Emails need an absolute address. */
  private emailLink(request: ApprovalRequest): string {
    return new URL(this.link(request), this.env.APP_PUBLIC_URL).toString();
  }

  private async userIdsOf(tx: TenantTransaction, membershipIds: string[]): Promise<string[]> {
    const rows = await tx.tenantMembership.findMany({
      where: { id: { in: membershipIds } },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  private async notifyAssignees(tx: TenantTransaction, request: ApprovalRequest, membershipIds: string[]) {
    const requester = await tx.tenantMembership.findUnique({
      where: { id: request.requestedByMembershipId },
      select: { user: { select: { displayName: true } } },
    });
    const who = requester?.user.displayName ?? 'Someone';
    const what = subjectLabel(request.subjectType).toLowerCase();
    await createNotifications(tx, request.tenantId, {
      recipientUserIds: await this.userIdsOf(tx, membershipIds),
      category: 'approval.assigned',
      emailDefault: NOTIFICATION_CATEGORIES['approval.assigned'].emailDefault,
      title: `${who} needs your approval`,
      body: `${request.title} (${what})`,
      link: this.link(request),
      email: {
        subject: `Approval needed: ${request.title}`,
        text: `${who} submitted a ${what} that needs your approval:\n\n  ${request.title}\n\nOpen Smart HR to review it: ${this.emailLink(request)}`,
      },
    });
  }

  private async notifyRequester(
    tx: TenantTransaction,
    request: ApprovalRequest,
    outcome: 'approved' | 'rejected' | 'sent back',
    actor: ApprovalActor | null,
    comment: string | null,
  ) {
    const by = actor ? ` by ${actor.displayName}` : '';
    const reason = comment ? `\n\nReason: ${comment}` : '';
    await createNotifications(tx, request.tenantId, {
      recipientUserIds: await this.userIdsOf(tx, [request.requestedByMembershipId]),
      category: 'approval.decided',
      emailDefault: NOTIFICATION_CATEGORIES['approval.decided'].emailDefault,
      title: `Your request was ${outcome}`,
      body: `${request.title} was ${outcome}${by}.${comment ? ` ${comment}` : ''}`,
      link: this.link(request),
      email: {
        subject: `Your request was ${outcome}: ${request.title}`,
        text: `${request.title} was ${outcome}${by}.${reason}\n\nDetails: ${this.emailLink(request)}`,
      },
    });
    await this.notifySubject(tx, request, '', outcome);
  }
}
