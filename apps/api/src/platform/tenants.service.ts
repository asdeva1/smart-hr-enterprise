import { Inject, Injectable } from '@nestjs/common';
import { normalizeEmail } from '@smart-hr/auth';
import {
  setTenantContext,
  type DatabaseClient,
  type Tenant,
  type TenantTransaction,
} from '@smart-hr/database';
import { AppError, NotFoundError } from '@smart-hr/shared';
import type { provisionTenantSchema, tenantLifecycleSchema } from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { InvitationService } from '../identity/invitation.service.js';
import { TenantProvisioner } from '../identity/tenant-provisioner.js';
import { DATABASE } from '../infra/tokens.js';
import { asPlatform } from './platform-context.js';

/**
 * Organisations as the platform sees them: creating them for a first owner, and their lifecycle.
 *
 *   ACTIVE ──suspend──▶ SUSPENDED ──reactivate──▶ ACTIVE           (no access while suspended)
 *   ACTIVE ──start_offboarding──▶ OFFBOARDING ──archive──▶ ARCHIVED (read-only + export, then no access)
 *
 * Nothing here deletes organisation data. Archived data is retained until a separately approved,
 * documented retention process removes it.
 */
@Injectable()
export class PlatformTenantsService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly audit: AuditService,
    private readonly provisioner: TenantProvisioner,
    private readonly invitations: InvitationService,
  ) {}

  async provision(auth: AuthContext, input: z.output<typeof provisionTenantSchema>, meta: RequestMeta) {
    const email = normalizeEmail(input.ownerEmail);
    // The global identity first: reuse an existing account, or create one without a password.
    const existing = await this.db.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true },
    });
    const owner =
      existing ??
      (await this.db.user.create({
        data: { email, displayName: input.ownerName },
        select: { id: true, passwordHash: true },
      }));

    const { tenant } = await asPlatform(this.db, auth, async (tx) => {
      const sub = input.subscription;
      const version = sub ? await tx.planVersion.findUnique({ where: { id: sub.planVersionId } }) : null;
      if (sub && (!version || version.status !== 'PUBLISHED')) {
        throw new AppError('VERSION_NOT_FOR_SALE', 'Only a published plan version can be assigned', 409, [
          { path: 'subscription.planVersionId', message: 'Choose a published version' },
        ]);
      }
      return this.provisioner.create(tx, {
        name: input.name,
        slug: input.slug,
        ownerUserId: owner.id,
        ...(sub && version
          ? {
              plan: {
                version,
                status: sub.status,
                ...(sub.trialDays !== undefined ? { trialDays: sub.trialDays } : {}),
                currentPeriodEnd: sub.currentPeriodEnd ?? null,
                licensedEmployees: sub.licensedEmployees ?? null,
              },
            }
          : {}),
        actorUserId: auth.user.id,
        source: 'platform',
        meta,
      });
    });

    if (owner.passwordHash === null) {
      await this.invitations.send(owner.id, email, input.ownerName, tenant.name, 'Smart HR');
    }
    return { id: tenant.id, slug: tenant.slug, name: tenant.name, ownerInvited: owner.passwordHash === null };
  }

  async overview(auth: AuthContext, tenantId: string) {
    return asPlatform(
      this.db,
      auth,
      async (tx) => {
        const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) throw new NotFoundError('Organisation');
        const members = await tx.tenantMembership.groupBy({ by: ['status'], _count: { _all: true } });
        const owners = await tx.tenantMembership.findMany({
          where: { isTenantAdmin: true },
          select: { id: true, status: true, user: { select: { email: true, displayName: true } } },
        });
        const companies = await tx.company.count({ where: { status: 'ACTIVE' } });
        return {
          tenant,
          members: Object.fromEntries(members.map((m) => [m.status, m._count._all])),
          owners: owners.map((o) => ({ ...o.user, status: o.status })),
          companies,
        };
      },
      tenantId,
    );
  }

  async lifecycle(
    auth: AuthContext,
    tenantId: string,
    input: z.output<typeof tenantLifecycleSchema>,
    meta: RequestMeta,
  ) {
    return asPlatform(this.db, auth, async (tx) => {
      await setTenantContext(tx, tenantId);
      await tx.$queryRaw`SELECT 1 FROM tenant WHERE id = ${tenantId}::uuid FOR UPDATE`;
      const before = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!before) throw new NotFoundError('Organisation');
      const conflict = (message: string) => new AppError('INVALID_TRANSITION', message, 409);
      let data: Partial<Tenant>;

      switch (input.action) {
        case 'rename':
          data = { name: input.name };
          break;
        case 'suspend':
          if (before.status !== 'ACTIVE' && before.status !== 'OFFBOARDING') {
            throw conflict('Only an active or offboarding organisation can be suspended');
          }
          data = { status: 'SUSPENDED' };
          break;
        case 'reactivate':
          if (before.status !== 'SUSPENDED')
            throw conflict('Only a suspended organisation can be reactivated');
          data = { status: before.offboardingAt ? 'OFFBOARDING' : 'ACTIVE' };
          break;
        case 'start_offboarding':
          if (before.status !== 'ACTIVE') throw conflict('Only an active organisation can start offboarding');
          data = { status: 'OFFBOARDING', offboardingAt: new Date() };
          break;
        case 'cancel_offboarding':
          if (before.status !== 'OFFBOARDING') throw conflict('This organisation is not offboarding');
          data = { status: 'ACTIVE', offboardingAt: null };
          break;
        case 'archive':
          if (before.status !== 'OFFBOARDING') {
            throw conflict('Start offboarding first, so the organisation can export its data');
          }
          if (input.confirmSlug !== before.slug) {
            throw new AppError('CONFIRMATION_MISMATCH', 'Type the organisation’s address to confirm', 422, [
              { path: 'confirmSlug', message: `Type ${before.slug}` },
            ]);
          }
          data = { status: 'ARCHIVED', archivedAt: new Date() };
          break;
      }

      const after = await tx.tenant.update({ where: { id: tenantId }, data });
      if (after.status !== 'ACTIVE' && after.status !== 'OFFBOARDING') {
        // Anyone signed in to this organisation loses it at once (the guard re-checks status every request,
        // but sessions are also moved off it so the browser stops offering it).
        await tx.userSession.updateMany({
          where: { activeTenantId: tenantId },
          data: { activeTenantId: null },
        });
      }
      await this.audit.recordInTransaction(
        tx,
        {
          action: `platform.tenant.${input.action}`,
          outcome: 'SUCCESS',
          tenantId,
          actorUserId: auth.user.id,
          targetType: 'tenant',
          targetId: tenantId,
          metadata: {
            from: before.status,
            to: after.status,
            ...('reason' in input && input.reason ? { reason: input.reason } : {}),
            ...(input.action === 'rename' ? { name: input.name } : {}),
          },
        },
        meta,
      );
      return after;
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Platform operators

  async operators(auth: AuthContext) {
    return asPlatform(this.db, auth, (tx) =>
      tx.user.findMany({
        where: { isPlatformAdmin: true },
        orderBy: { displayName: 'asc' },
        select: {
          id: true,
          email: true,
          displayName: true,
          status: true,
          mfaEnabledAt: true,
          lastLoginAt: true,
        },
      }),
    );
  }

  /** Only existing accounts can be made operators; nobody is created here. */
  async grantOperator(auth: AuthContext, email: string, meta: RequestMeta) {
    return this.setOperator(auth, { email: normalizeEmail(email) }, true, meta);
  }

  async revokeOperator(auth: AuthContext, userId: string, meta: RequestMeta) {
    if (userId === auth.user.id) {
      throw new AppError('CANNOT_CHANGE_SELF', 'You can’t remove your own platform access', 400);
    }
    return this.setOperator(auth, { id: userId }, false, meta);
  }

  private async setOperator(
    auth: AuthContext,
    where: { email: string } | { id: string },
    grant: boolean,
    meta: RequestMeta,
  ) {
    return asPlatform(this.db, auth, async (tx: TenantTransaction) => {
      const user = await tx.user.findUnique({
        where,
        select: { id: true, email: true, isPlatformAdmin: true },
      });
      if (!user) {
        throw new AppError('NO_SUCH_ACCOUNT', 'There is no Smart HR account with that email address', 404, [
          { path: 'email', message: 'Ask them to accept an invitation or sign up first' },
        ]);
      }
      if (user.isPlatformAdmin === grant) return { id: user.id, email: user.email, isPlatformAdmin: grant };
      if (!grant) {
        const remaining = await tx.user.count({ where: { isPlatformAdmin: true, status: 'ACTIVE' } });
        if (remaining <= 1)
          throw new AppError('LAST_OPERATOR', 'At least one platform operator must remain', 409);
      }
      // Takes effect on the next request: platform routes check the flag every time.
      await tx.user.update({ where: { id: user.id }, data: { isPlatformAdmin: grant } });
      await this.audit.recordInTransaction(
        tx,
        {
          action: grant ? 'platform.operator.grant' : 'platform.operator.revoke',
          outcome: 'SUCCESS',
          actorUserId: auth.user.id,
          targetType: 'user',
          targetId: user.id,
        },
        meta,
      );
      return { id: user.id, email: user.email, isPlatformAdmin: grant };
    });
  }
}
