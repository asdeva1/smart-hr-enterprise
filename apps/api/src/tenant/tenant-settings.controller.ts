import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { withContext, type DatabaseClient } from '@smart-hr/database';
import { AppError, ForbiddenError, NotFoundError } from '@smart-hr/shared';
import { isOrganisationSetting, parseSetting } from '@smart-hr/validation';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import {
  CurrentAuth,
  CurrentTenant,
  RequirePermission,
  RequireTenant,
  RequireRecentAuth,
} from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { DATABASE } from '../infra/tokens.js';

export const settingKey = z
  .string()
  .regex(/^[a-z][a-z0-9_.]{1,63}$/, 'Use lower-case letters, digits, dots and underscores');
export const settingBody = z.object({ value: z.json() });

/**
 * Raw organisation settings, one key at a time. Writes accept only declared settings with valid values
 * (see ORGANISATION_SETTINGS); the settings page uses /v1/tenant/configuration.
 * The first tenant-scoped API. The tenant always comes from the verified session,
 * never from the URL or body, and every query runs inside withContext, so RLS applies underneath.
 */
@ApiTags('organisation settings')
@RequireTenant()
@Controller('v1/tenant/settings')
export class TenantSettingsController {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly audit: AuditService,
  ) {}

  private ctx(tenantId: string, auth: AuthContext) {
    return { tenantId, userId: auth.user.id };
  }

  @Get()
  @ApiOperation({ summary: 'List settings of the active organisation' })
  async list(@CurrentTenant() tenant: { id: string }, @CurrentAuth() auth: AuthContext) {
    return withContext(this.db, this.ctx(tenant.id, auth), (tx) =>
      tx.tenantSetting.findMany({
        orderBy: { key: 'asc' },
        select: { id: true, key: true, value: true, updatedAt: true },
      }),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'One setting by id' })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: { id: string },
    @CurrentAuth() auth: AuthContext,
  ) {
    const setting = await withContext(this.db, this.ctx(tenant.id, auth), (tx) =>
      tx.tenantSetting.findUnique({
        where: { id },
        select: { id: true, key: true, value: true, updatedAt: true },
      }),
    );
    // Another tenant's id is invisible under RLS, so it is indistinguishable from a missing one.
    if (!setting) throw new NotFoundError('Setting');
    return setting;
  }

  @RequirePermission('settings.manage')
  @Put(':key')
  @RequireRecentAuth()
  @ApiOperation({ summary: 'Create or update a setting (settings.manage)' })
  async put(
    @Param('key', { schema: settingKey }) key: string,
    @Body({ schema: settingBody }) body: z.infer<typeof settingBody>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    // Organisation settings apply everywhere, so a company-scoped grant isn't enough.
    if (!tenant.permissions.allowsTenantWide('settings.manage')) throw new ForbiddenError();
    if (!isOrganisationSetting(key)) {
      throw new AppError('UNKNOWN_SETTING', 'Unknown setting', 400, [
        { path: 'key', message: 'Unknown setting' },
      ]);
    }
    const parsed = parseSetting(key, body.value);
    if (!parsed.ok)
      throw new AppError('VALIDATION_FAILED', parsed.message, 400, [
        { path: 'value', message: parsed.message },
      ]);
    const value = parsed.value;
    const saved = await withContext(this.db, this.ctx(tenant.id, auth), (tx) =>
      tx.tenantSetting.upsert({
        where: { tenantId_key: { tenantId: tenant.id, key } },
        create: { tenantId: tenant.id, key, value: value as object },
        update: { value: value as object },
        select: { id: true, key: true, value: true, updatedAt: true },
      }),
    );
    await this.audit.record(
      {
        action: 'tenant.setting.update',
        outcome: 'SUCCESS',
        tenantId: tenant.id,
        actorUserId: auth.user.id,
        targetType: 'tenant_setting',
        targetId: saved.id,
        metadata: { key },
      },
      requestMeta(req),
    );
    return saved;
  }
}
