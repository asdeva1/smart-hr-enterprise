import { Inject, Injectable } from '@nestjs/common';
import { withContext, type DatabaseClient, type TenantTransaction } from '@smart-hr/database';
import {
  APPROVAL_SUBJECTS,
  AppError,
  ForbiddenError,
  isApprovalSubject,
  isPermission,
  NotFoundError,
  type ScopeRef,
} from '@smart-hr/shared';
import {
  approvalDecisionSchema,
  approvalListQuerySchema,
  createApprovalPolicySchema,
  delegationSchema,
  type ApprovalPolicyDefinition,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { DATABASE } from '../infra/tokens.js';
import { RbacService } from '../rbac/rbac.service.js';
import { ApprovalEngine, type ApprovalActor } from './approval.engine.js';

const REQUEST_SUMMARY = {
  id: true,
  subjectType: true,
  subjectId: true,
  title: true,
  amount: true,
  currency: true,
  status: true,
  currentStage: true,
  round: true,
  createdAt: true,
  decidedAt: true,
  scopeType: true,
  scopeId: true,
  requestedBy: { select: { id: true, user: { select: { displayName: true } } } },
} as const;

function actorOf(tenant: TenantContext, auth: AuthContext): ApprovalActor {
  return {
    tenantId: tenant.id,
    membershipId: tenant.membershipId,
    userId: auth.user.id,
    displayName: auth.user.displayName,
  };
}

/** Request summaries as the API returns them: money as an exact string, the subject's label attached. */
function summary<T extends { amount: { toFixed(dp: number): string } | null; subjectType: string }>(r: T) {
  return {
    ...r,
    amount: r.amount ? r.amount.toFixed(2) : null,
    subjectLabel: isApprovalSubject(r.subjectType) ? APPROVAL_SUBJECTS[r.subjectType].label : r.subjectType,
  };
}

@Injectable()
export class ApprovalsService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly engine: ApprovalEngine,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  private run<T>(tenant: TenantContext, auth: AuthContext, work: (tx: TenantTransaction) => Promise<T>) {
    return withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, work);
  }

  /** Whether the caller may see every request at this scope (approvals.view_all covering it). */
  private async canViewAll(tx: TenantTransaction, tenant: TenantContext, scope: ScopeRef) {
    if (!tenant.permissions.hasAnywhere('approvals.view_all')) return false;
    return tenant.permissions.allows('approvals.view_all', await this.rbac.scopesOf(tx, tenant.id, scope));
  }

  // ---- Inbox and requests -------------------------------------------------------------------

  async inbox(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const tasks = await tx.approvalTask.findMany({
        where: { assigneeMembershipId: tenant.membershipId, status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          stage: true,
          stageName: true,
          dueAt: true,
          createdAt: true,
          delegatedFromMembershipId: true,
          request: { select: REQUEST_SUMMARY },
        },
      });
      return tasks.map((t) => ({ ...t, request: summary(t.request) }));
    });
  }

  async listRequests(
    tenant: TenantContext,
    auth: AuthContext,
    query: z.output<typeof approvalListQuerySchema>,
  ) {
    if (query.view === 'all' && !tenant.permissions.hasAnywhere('approvals.view_all'))
      throw new ForbiddenError();
    return this.run(tenant, auth, async (tx) => {
      const rows = await tx.approvalRequest.findMany({
        where: {
          ...(query.view === 'mine' ? { requestedByMembershipId: tenant.membershipId } : {}),
          ...(query.status ? { status: query.status } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: query.view === 'all' ? query.limit * 4 : query.limit,
        select: REQUEST_SUMMARY,
      });
      if (query.view === 'mine') return rows.map(summary);
      // Scope-filter "everything" views; cache scope lookups per distinct scope.
      const cache = new Map<string, boolean>();
      const visible = [];
      for (const r of rows) {
        const key = `${r.scopeType}:${r.scopeId}`;
        if (!cache.has(key))
          cache.set(key, await this.canViewAll(tx, tenant, { type: r.scopeType, id: r.scopeId }));
        if (cache.get(key)) visible.push(r);
        if (visible.length >= query.limit) break;
      }
      return visible.map(summary);
    });
  }

  async getRequest(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, async (tx) => {
      const request = await tx.approvalRequest.findUnique({
        where: { id },
        select: {
          ...REQUEST_SUMMARY,
          policy: { select: { id: true, name: true, version: true, definition: true } },
          tasks: {
            orderBy: [{ round: 'asc' }, { stage: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              round: true,
              stage: true,
              stageName: true,
              status: true,
              comment: true,
              actedAt: true,
              dueAt: true,
              assigneeMembershipId: true,
              delegatedFromMembershipId: true,
              assignee: { select: { user: { select: { displayName: true } } } },
            },
          },
        },
      });
      if (!request) throw new NotFoundError('Approval request');
      const involved =
        request.requestedBy.id === tenant.membershipId ||
        request.tasks.some((t) => t.assigneeMembershipId === tenant.membershipId);
      if (
        !involved &&
        !(await this.canViewAll(tx, tenant, { type: request.scopeType, id: request.scopeId }))
      ) {
        // Not involved and no oversight permission: indistinguishable from a request that doesn't exist.
        throw new NotFoundError('Approval request');
      }
      const definition = request.policy.definition as ApprovalPolicyDefinition;
      return {
        ...summary(request),
        policy: { id: request.policy.id, name: request.policy.name, version: request.policy.version },
        stages: definition.stages.map((s) => ({
          name: s.name,
          mode: s.mode,
          minAmount: s.minAmount ?? null,
        })),
        tasks: request.tasks.map((t) => ({
          id: t.id,
          round: t.round,
          stage: t.stage,
          stageName: t.stageName,
          status: t.status,
          comment: t.comment,
          actedAt: t.actedAt,
          dueAt: t.dueAt,
          assignee: t.assignee.user.displayName,
          delegated: t.delegatedFromMembershipId !== null,
          isMine: t.assigneeMembershipId === tenant.membershipId,
        })),
        isMine: request.requestedBy.id === tenant.membershipId,
      };
    });
  }

  async decide(
    tenant: TenantContext,
    auth: AuthContext,
    taskId: string,
    input: z.output<typeof approvalDecisionSchema>,
    meta: RequestMeta,
  ) {
    const result = await this.run(tenant, auth, (tx) =>
      this.engine.decide(tx, actorOf(tenant, auth), taskId, input.decision, input.comment ?? null, meta),
    );
    return { status: result.status };
  }

  async cancel(tenant: TenantContext, auth: AuthContext, requestId: string, meta: RequestMeta) {
    const r = await this.run(tenant, auth, (tx) =>
      this.engine.cancel(tx, actorOf(tenant, auth), requestId, meta),
    );
    return { status: r.status };
  }

  async resubmit(tenant: TenantContext, auth: AuthContext, requestId: string, meta: RequestMeta) {
    const r = await this.run(tenant, auth, (tx) =>
      this.engine.resubmit(tx, actorOf(tenant, auth), requestId, meta),
    );
    return { status: r.status };
  }

  // ---- Policies -----------------------------------------------------------------------------

  async listPolicies(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const policies = await tx.approvalPolicy.findMany({
        orderBy: [{ subjectType: 'asc' }, { version: 'desc' }],
      });
      return Object.entries(APPROVAL_SUBJECTS).map(([subjectType, def]) => {
        const versions = policies.filter((p) => p.subjectType === subjectType);
        const active = versions.find((p) => p.isActive) ?? null;
        return {
          subjectType,
          label: def.label,
          module: def.module,
          hasAmount: def.hasAmount,
          active: active
            ? {
                id: active.id,
                name: active.name,
                version: active.version,
                definition: active.definition,
                createdAt: active.createdAt,
              }
            : null,
          versions: versions.length,
        };
      });
    });
  }

  /** Publishes a new version. Requests already in progress keep the version they started with. */
  async createPolicy(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof createApprovalPolicySchema>,
    meta: RequestMeta,
  ) {
    if (!tenant.permissions.allowsTenantWide('approvals.manage')) throw new ForbiddenError();
    if (!isApprovalSubject(input.subjectType)) {
      throw new AppError('UNKNOWN_SUBJECT', 'Unknown approval subject', 400, [
        { path: 'subjectType', message: 'Unknown subject' },
      ]);
    }
    const subject = APPROVAL_SUBJECTS[input.subjectType];
    return this.run(tenant, auth, async (tx) => {
      // Every reference must exist in this organisation (RLS hides other tenants' ids).
      for (const [i, stage] of input.definition.stages.entries()) {
        for (const rule of stage.approvers) {
          if (rule.type === 'ROLE' && !(await tx.role.findUnique({ where: { id: rule.roleId } }))) {
            throw new AppError('UNKNOWN_ROLE', `Stage ${i + 1} uses a role that doesn’t exist`, 400);
          }
          if (
            rule.type === 'MEMBER' &&
            !(await tx.tenantMembership.findUnique({ where: { id: rule.membershipId } }))
          ) {
            throw new AppError('UNKNOWN_MEMBER', `Stage ${i + 1} names someone who isn’t a member`, 400);
          }
          if (rule.type === 'PERMISSION' && !isPermission(rule.permission)) {
            throw new AppError('UNKNOWN_PERMISSION', `Stage ${i + 1} uses an unknown permission`, 400);
          }
        }
        if (stage.minAmount && !subject.hasAmount) {
          throw new AppError('NO_AMOUNT', `${subject.label} has no amount to compare`, 400);
        }
      }
      // Serialise version numbers per subject type.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenant.id}:${input.subjectType}`}))`;
      const latest = await tx.approvalPolicy.findFirst({
        where: { subjectType: input.subjectType },
        orderBy: { version: 'desc' },
      });
      await tx.approvalPolicy.updateMany({
        where: { subjectType: input.subjectType },
        data: { isActive: false },
      });
      const policy = await tx.approvalPolicy.create({
        data: {
          tenantId: tenant.id,
          subjectType: input.subjectType,
          version: (latest?.version ?? 0) + 1,
          name: input.name,
          definition: input.definition,
          createdByUserId: auth.user.id,
        },
      });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'approval.policy.publish',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'approval_policy',
          targetId: policy.id,
          metadata: {
            subjectType: input.subjectType,
            version: policy.version,
            stages: input.definition.stages.length,
          },
        },
        meta,
      );
      return { id: policy.id, version: policy.version };
    });
  }

  // ---- Delegations --------------------------------------------------------------------------

  /**
   * Active colleagues to delegate to: names only, the same a member sees on any approval.
   * Kept separate from the people directory, which needs access.view and shows far more.
   */
  async colleagues(tenant: TenantContext, auth: AuthContext, search: string) {
    return this.run(tenant, auth, async (tx) => {
      const rows = await tx.tenantMembership.findMany({
        where: {
          id: { not: tenant.membershipId },
          status: 'ACTIVE',
          user: {
            status: 'ACTIVE',
            ...(search ? { displayName: { contains: search, mode: 'insensitive' as const } } : {}),
          },
        },
        orderBy: { user: { displayName: 'asc' } },
        take: 20,
        select: { id: true, user: { select: { displayName: true } } },
      });
      return rows.map((r) => ({ membershipId: r.id, displayName: r.user.displayName }));
    });
  }

  async listDelegations(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const rows = await tx.approvalDelegation.findMany({
        where: {
          OR: [{ fromMembershipId: tenant.membershipId }, { toMembershipId: tenant.membershipId }],
          revokedAt: null,
          endsAt: { gt: new Date() },
        },
        orderBy: { startsAt: 'asc' },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          reason: true,
          fromMembershipId: true,
          from: { select: { user: { select: { displayName: true } } } },
          to: { select: { user: { select: { displayName: true } } } },
        },
      });
      return rows.map((d) => ({
        id: d.id,
        startsAt: d.startsAt,
        endsAt: d.endsAt,
        reason: d.reason,
        direction: d.fromMembershipId === tenant.membershipId ? 'given' : 'received',
        from: d.from.user.displayName,
        to: d.to.user.displayName,
      }));
    });
  }

  async createDelegation(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof delegationSchema>,
    meta: RequestMeta,
  ) {
    if (input.toMembershipId === tenant.membershipId) {
      throw new AppError('DELEGATE_SELF', 'Choose someone other than yourself', 400, [
        { path: 'toMembershipId', message: 'Choose someone else' },
      ]);
    }
    return this.run(tenant, auth, async (tx) => {
      const to = await tx.tenantMembership.findFirst({
        where: { id: input.toMembershipId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!to) throw new NotFoundError('Member');
      const delegation = await tx.approvalDelegation.create({
        data: {
          tenantId: tenant.id,
          fromMembershipId: tenant.membershipId,
          toMembershipId: to.id,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          reason: input.reason ?? null,
        },
        select: { id: true },
      });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'approval.delegation.create',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'membership',
          targetId: to.id,
          metadata: { startsAt: input.startsAt, endsAt: input.endsAt },
        },
        meta,
      );
      return delegation;
    });
  }

  async revokeDelegation(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    await this.run(tenant, auth, async (tx) => {
      const revoked = await tx.approvalDelegation.updateMany({
        where: { id, fromMembershipId: tenant.membershipId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count === 0) throw new NotFoundError('Delegation');
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'approval.delegation.revoke',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'approval_delegation',
          targetId: id,
        },
        meta,
      );
    });
  }
}
