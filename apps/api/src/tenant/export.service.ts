import { Inject, Injectable } from '@nestjs/common';
import { withContext, type DatabaseClient, type TenantTransaction } from '@smart-hr/database';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { DATABASE } from '../infra/tokens.js';

export type ExportSection = (tx: TenantTransaction) => Promise<unknown>;

/** Most recent audit events included in an export; older ones stay in the database. */
const AUDIT_EXPORT_LIMIT = 50_000;

/**
 * A complete, machine-readable copy of an organisation's data, for portability and offboarding. Each module
 * registers a section for what it owns, so the export grows with the product. Runs in the organisation's
 * own transaction: row-level security guarantees nothing from another organisation can be included.
 * Secrets (password hashes, MFA secrets, tokens) are never part of any section.
 */
@Injectable()
export class TenantExportService {
  private readonly sections = new Map<string, ExportSection>();

  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly audit: AuditService,
  ) {
    this.register('organisation', (tx) =>
      tx.tenant.findFirst({
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          requireMfa: true,
          brandName: true,
          brandColor: true,
          brandLogoUrl: true,
          createdAt: true,
        },
      }),
    );
    this.register('companies', (tx) => tx.company.findMany({ orderBy: { code: 'asc' } }));
    this.register('branches', (tx) => tx.branch.findMany({ orderBy: { code: 'asc' } }));
    this.register('departments', (tx) => tx.department.findMany({ orderBy: { code: 'asc' } }));
    this.register('members', (tx) =>
      tx.tenantMembership.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          status: true,
          isTenantAdmin: true,
          createdAt: true,
          user: { select: { id: true, email: true, displayName: true, status: true } },
        },
      }),
    );
    this.register('roles', (tx) =>
      tx.role.findMany({
        include: { permissions: { select: { permission: true } } },
        orderBy: { key: 'asc' },
      }),
    );
    this.register('roleAssignments', (tx) => tx.roleAssignment.findMany({ orderBy: { createdAt: 'asc' } }));
    this.register('settings', (tx) => tx.tenantSetting.findMany({ orderBy: { key: 'asc' } }));
    this.register('referenceLists', (tx) =>
      tx.lookupValue.findMany({ orderBy: [{ list: 'asc' }, { sortOrder: 'asc' }] }),
    );
    this.register('approvalPolicies', (tx) => tx.approvalPolicy.findMany({ orderBy: { createdAt: 'asc' } }));
    this.register('approvalRequests', (tx) =>
      tx.approvalRequest.findMany({ include: { tasks: true }, orderBy: { createdAt: 'asc' } }),
    );
    this.register('subscription', async (tx) => ({
      current: await tx.subscription.findFirst({
        include: { planVersion: { select: { version: true, plan: { select: { code: true, name: true } } } } },
      }),
      history: await tx.subscriptionEvent.findMany({ orderBy: { occurredAt: 'asc' } }),
    }));
    this.register('auditLog', (tx) =>
      tx.auditEvent.findMany({ orderBy: { occurredAt: 'desc' }, take: AUDIT_EXPORT_LIMIT }),
    );
  }

  register(section: string, read: ExportSection): void {
    this.sections.set(section, read);
  }

  async export(tenant: TenantContext, auth: AuthContext, meta: RequestMeta) {
    return withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, async (tx) => {
      const data: Record<string, unknown> = {};
      for (const [name, read] of this.sections) data[name] = await read(tx);
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'tenant.data.export',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'tenant',
          targetId: tenant.id,
          metadata: { sections: [...this.sections.keys()] },
        },
        meta,
      );
      return {
        format: 'smart-hr-export',
        version: 1,
        exportedAt: new Date().toISOString(),
        exportedBy: auth.user.email,
        sections: data,
      };
    });
  }
}
