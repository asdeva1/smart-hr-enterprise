import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { configurationUpdateSchema } from '@smart-hr/validation';
import type { z } from 'zod';
import {
  CurrentAuth,
  CurrentTenant,
  RequirePermission,
  RequireTenant,
  RequireRecentAuth,
} from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { ConfigurationService } from './configuration.service.js';

/** Organisation settings with their schemas. Every member can read them (forms need the formats). */
@ApiTags('organisation settings')
@RequireTenant()
@Controller('v1/tenant/configuration')
export class ConfigurationController {
  constructor(private readonly configuration: ConfigurationService) {}

  @Get()
  @ApiOperation({ summary: 'Every organisation setting with its current value' })
  describe(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.configuration.describe(tenant, auth);
  }

  @Put()
  @RequireRecentAuth()
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Change one or more settings (settings.manage, whole organisation)' })
  update(
    @Body({ schema: configurationUpdateSchema }) body: z.output<typeof configurationUpdateSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.configuration.update(tenant, auth, body.values, requestMeta(req));
  }
}
