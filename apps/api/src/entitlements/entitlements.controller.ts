import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { withContext, type DatabaseClient } from '@smart-hr/database';
import {
  ALL_FEATURES,
  ALL_LIMITS,
  FEATURES,
  LIMITS,
  type Entitlements,
  type LimitKey,
} from '@smart-hr/entitlements';
import { CurrentAuth, CurrentTenant, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { DATABASE } from '../infra/tokens.js';
import { EntitlementsService } from './entitlements.service.js';
import { LicenceService } from './licence.service.js';

@ApiTags('plan')
@Controller('v1/tenant/plan')
export class EntitlementsController {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly entitlements: EntitlementsService,
    private readonly licences: LicenceService,
  ) {}

  @Get()
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'The organisation’s plan, what it includes, and usage against its limits' })
  async plan(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, async (tx) => {
      // Sequential: one transaction is one connection.
      const entitlements = await this.entitlements.forTenant(tx);
      const usage = await this.entitlements.usage(tx);
      // In-house, the installation's licence is the only source; a stored subscription would mislead.
      if (this.licences.inHouse) {
        const current = await this.licences.current(tx);
        const payload = current?.payload ?? current?.unverified ?? null;
        return {
          source: 'licence' as const,
          entitlements,
          subscription: null,
          licence: payload && {
            customer: payload.customer.name,
            supportLevel: payload.supportLevel,
            expiresAt: payload.expiresAt,
            graceDays: payload.graceDays,
            verified: !!current?.payload,
          },
          ...this.catalogue(entitlements, usage),
        };
      }
      const sub = await tx.subscription.findFirst({
        include: {
          planVersion: { select: { supportLevel: true, deploymentModels: true } },
          addons: { include: { addon: { select: { code: true, name: true, kind: true } } } },
        },
      });
      return {
        source: 'subscription' as const,
        entitlements,
        licence: null,
        subscription: sub
          ? {
              storedStatus: sub.status,
              billingPeriod: sub.billingPeriod,
              currency: sub.currency,
              trialEndsAt: sub.trialEndsAt,
              currentPeriodStart: sub.currentPeriodStart,
              currentPeriodEnd: sub.currentPeriodEnd,
              cancelledAt: sub.cancelledAt,
              supportLevel: sub.planVersion.supportLevel,
              deploymentModels: sub.planVersion.deploymentModels,
              addons: sub.addons.map((a) => ({
                code: a.addon.code,
                name: a.addon.name,
                kind: a.addon.kind,
                quantity: a.quantity,
              })),
            }
          : null,
        ...this.catalogue(entitlements, usage),
      };
    });
  }

  private catalogue(entitlements: Entitlements, usage: Partial<Record<LimitKey, number>>) {
    const included = new Set(entitlements.features);
    return {
      features: ALL_FEATURES.map((code) => ({ code, ...FEATURES[code], included: included.has(code) })),
      limits: ALL_LIMITS.map((code) => ({
        code,
        ...LIMITS[code],
        limit: entitlements.limits[code] ?? null,
        used: usage[code] ?? null,
      })),
    };
  }
}
