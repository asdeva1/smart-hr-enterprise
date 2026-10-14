import { Injectable } from '@nestjs/common';
import {
  isUniqueViolation,
  setTenantContext,
  type PlanVersion,
  type TenantTransaction,
} from '@smart-hr/database';
import { AppError } from '@smart-hr/shared';
import type { RequestMeta } from '../common/request-context.js';
import { RbacService } from '../rbac/rbac.service.js';

export interface NewTenant {
  name: string;
  slug: string;
  ownerUserId: string;
  /** Starts the subscription in the same transaction. */
  plan?: {
    version: PlanVersion;
    status: 'TRIAL' | 'ACTIVE';
    trialDays?: number;
    currentPeriodEnd?: Date | null;
  };
  actorUserId: string | null;
  source: 'platform' | 'signup';
  meta: RequestMeta;
}

const DAY = 86_400_000;

/**
 * Creates an organisation with its built-in roles, first owner and (optionally) subscription, in one
 * transaction. The caller's transaction must be a platform actor without a tenant in scope: the database only
 * lets platform actors create organisations. After the tenant exists, the transaction switches to it, so
 * everything else is written under that tenant's row-level security.
 */
@Injectable()
export class TenantProvisioner {
  constructor(private readonly rbac: RbacService) {}

  async create(tx: TenantTransaction, input: NewTenant) {
    let tenant;
    try {
      tenant = await tx.tenant.create({ data: { name: input.name, slug: input.slug } });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError('SLUG_TAKEN', 'Another organisation already uses this address', 409, [
          { path: 'slug', message: 'Already in use' },
        ]);
      }
      throw error;
    }
    await setTenantContext(tx, tenant.id);
    await this.rbac.ensureSystemRoles(tx, tenant.id);
    const membership = await tx.tenantMembership.create({
      data: { tenantId: tenant.id, userId: input.ownerUserId, isTenantAdmin: true },
    });

    if (input.plan) {
      const { version, status } = input.plan;
      const now = new Date();
      const trialDays = input.plan.trialDays ?? version.trialDays;
      if (status === 'TRIAL' && trialDays <= 0) {
        throw new AppError('NO_TRIAL', 'This plan has no trial. Set trial days or start it as active.', 422);
      }
      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          planVersionId: version.id,
          status,
          trialEndsAt: status === 'TRIAL' ? new Date(now.getTime() + trialDays * DAY) : null,
          currentPeriodStart: status === 'ACTIVE' ? now : null,
          currentPeriodEnd: status === 'ACTIVE' ? (input.plan.currentPeriodEnd ?? null) : null,
        },
      });
      await tx.subscriptionEvent.create({
        data: {
          tenantId: tenant.id,
          action: 'start',
          toStatus: status,
          planVersionId: version.id,
          actorUserId: input.actorUserId,
          details: { source: input.source },
        },
      });
    }

    await tx.auditEvent.createMany({
      data: [
        {
          action: 'platform.tenant.create',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: input.actorUserId,
          targetType: 'tenant',
          targetId: tenant.id,
          ipAddress: input.meta.ip,
          userAgent: input.meta.userAgent,
          requestId: input.meta.requestId,
          metadata: { slug: tenant.slug, source: input.source, ownerMembershipId: membership.id },
        },
      ],
    });
    return { tenant, membership };
  }
}
