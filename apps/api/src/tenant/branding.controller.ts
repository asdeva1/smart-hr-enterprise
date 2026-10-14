import { Body, Controller, Get, Inject, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { withContext, type DatabaseClient } from '@smart-hr/database';
import { ForbiddenError } from '@smart-hr/shared';
import { brandingSchema } from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { CurrentAuth, CurrentTenant, RequirePermission, RequireTenant } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { DATABASE } from '../infra/tokens.js';

const BRANDING = { brandName: true, brandColor: true, brandLogoUrl: true } as const;

@ApiTags('organisation')
@Controller('v1/tenant/branding')
export class BrandingController {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequireTenant()
  @ApiOperation({ summary: 'The organisation’s name, colour and logo as shown in the app' })
  get(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, (tx) =>
      tx.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: BRANDING }),
    );
  }

  @Put()
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Change branding (settings.manage, whole organisation)' })
  update(
    @Body({ schema: brandingSchema }) body: z.output<typeof brandingSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    if (!tenant.permissions.allowsTenantWide('settings.manage')) {
      throw new ForbiddenError();
    }
    return withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, async (tx) => {
      const branding = await tx.tenant.update({ where: { id: tenant.id }, data: body, select: BRANDING });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'tenant.branding.update',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'tenant',
          targetId: tenant.id,
          metadata: { ...branding },
        },
        requestMeta(req),
      );
      return branding;
    });
  }
}
