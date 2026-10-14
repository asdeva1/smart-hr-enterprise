import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { withContext, type DatabaseClient } from '@smart-hr/database';
import { ALL_FEATURES, ALL_LIMITS, FEATURES, LIMITS } from '@smart-hr/entitlements';
import { CurrentAuth, CurrentTenant, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { DATABASE } from '../infra/tokens.js';
import { EntitlementsService } from './entitlements.service.js';

@ApiTags('plan')
@Controller('v1/tenant/plan')
export class EntitlementsController {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Get()
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'The organisation’s plan, what it includes, and usage against its limits' })
  async plan(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, async (tx) => {
      // Sequential: one transaction is one connection.
      const entitlements = await this.entitlements.forTenant(tx);
      const usage = await this.entitlements.usage(tx);
      const sub = await tx.subscription.findFirst({
        include: {
          planVersion: { select: { supportLevel: true, deploymentModels: true } },
          addons: { include: { addon: { select: { code: true, name: true, kind: true } } } },
        },
      });
      const included = new Set(entitlements.features);
      return {
        entitlements,
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
        features: ALL_FEATURES.map((code) => ({ code, ...FEATURES[code], included: included.has(code) })),
        limits: ALL_LIMITS.map((code) => ({
          code,
          ...LIMITS[code],
          limit: entitlements.limits[code] ?? null,
          used: usage[code] ?? null,
        })),
      };
    });
  }
}
