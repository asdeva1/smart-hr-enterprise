import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  API_KEY_SCOPES,
  WEBHOOK_EVENTS,
  createApiKeySchema,
  createWebhookSchema,
  deliveryListQuerySchema,
  updateWebhookSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { CurrentAuth, CurrentTenant, RequireFeature, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { ApiKeysService } from './api-keys.service.js';
import { WebhooksService } from './webhooks.service.js';

/** Setting up integrations: administrators only, on plans that include them. */
@ApiTags('integrations')
@RequireFeature('integrations.custom')
@RequirePermission('settings.manage')
@Controller('v1/integrations')
export class IntegrationsController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly keys: ApiKeysService,
  ) {}

  @Get('options')
  options() {
    return { events: WEBHOOK_EVENTS, scopes: API_KEY_SCOPES };
  }

  @Get('webhooks')
  listWebhooks(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.webhooks.list(tenant, auth);
  }

  @Post('webhooks')
  createWebhook(
    @Body({ schema: createWebhookSchema }) body: z.output<typeof createWebhookSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.webhooks.create(tenant, auth, body, requestMeta(req));
  }

  @Patch('webhooks/:id')
  updateWebhook(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: updateWebhookSchema }) body: z.output<typeof updateWebhookSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.webhooks.update(tenant, auth, id, body, requestMeta(req));
  }

  @Post('webhooks/:id/rotate-secret')
  rotate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.webhooks.rotateSecret(tenant, auth, id, requestMeta(req));
  }

  @Post('webhooks/:id/test')
  test(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.webhooks.test(tenant, auth, id);
  }

  @Get('webhooks/:id/deliveries')
  deliveries(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query({ schema: deliveryListQuerySchema }) query: z.output<typeof deliveryListQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.webhooks.deliveries(tenant, auth, id, query);
  }

  @Get('api-keys')
  listKeys(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.keys.list(tenant, auth);
  }

  @Post('api-keys')
  createKey(
    @Body({ schema: createApiKeySchema }) body: z.output<typeof createApiKeySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.keys.create(tenant, auth, body, requestMeta(req));
  }

  @Post('api-keys/:id/revoke')
  revokeKey(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.keys.revoke(tenant, auth, id, requestMeta(req));
  }
}
