import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  assignSubscriptionSchema,
  createAddonSchema,
  createOverrideSchema,
  createPlanSchema,
  setSubscriptionAddonSchema,
  subscriptionActionSchema,
  updateAddonSchema,
  updatePlanVersionSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { CurrentAuth, RequirePlatformAdmin } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { PlansService } from './plans.service.js';
import { SubscriptionsService } from './subscriptions.service.js';

const uuid = new ParseUUIDPipe();

/** The plan catalogue. Platform administrators only. */
@ApiTags('platform')
@RequirePlatformAdmin()
@Controller('v1/platform')
export class PlatformPlansController {
  constructor(private readonly plans: PlansService) {}

  @Get('plans')
  @ApiOperation({ summary: 'Plans with all their versions and prices' })
  list(@CurrentAuth() auth: AuthContext) {
    return this.plans.list(auth);
  }

  @Post('plans')
  @ApiOperation({ summary: 'Create a plan (starts with an empty draft version 1)' })
  create(
    @Body({ schema: createPlanSchema }) body: z.output<typeof createPlanSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.plans.create(auth, body, requestMeta(req));
  }

  @Get('plans/:id')
  get(@Param('id', uuid) id: string, @CurrentAuth() auth: AuthContext) {
    return this.plans.get(auth, id);
  }

  @Post('plans/:id/versions')
  @ApiOperation({ summary: 'Start a new draft version from the newest one' })
  draft(@Param('id', uuid) id: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.plans.createDraft(auth, id, requestMeta(req));
  }

  @Patch('plan-versions/:id')
  @ApiOperation({ summary: 'Edit a draft version (features, limits, terms, prices)' })
  update(
    @Param('id', uuid) id: string,
    @Body({ schema: updatePlanVersionSchema }) body: z.output<typeof updatePlanVersionSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.plans.updateDraft(auth, id, body, requestMeta(req));
  }

  @Post('plan-versions/:id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish a draft; it can no longer be changed' })
  publish(@Param('id', uuid) id: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.plans.publish(auth, id, requestMeta(req));
  }

  @Post('plan-versions/:id/retire')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop selling a version; existing subscriptions keep it' })
  retire(@Param('id', uuid) id: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.plans.retire(auth, id, requestMeta(req));
  }

  @Delete('plan-versions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a draft version' })
  async remove(@Param('id', uuid) id: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    await this.plans.deleteDraft(auth, id, requestMeta(req));
  }

  @Get('addons')
  listAddons(@CurrentAuth() auth: AuthContext) {
    return this.plans.listAddons(auth);
  }

  @Post('addons')
  createAddon(
    @Body({ schema: createAddonSchema }) body: z.output<typeof createAddonSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.plans.createAddon(auth, body, requestMeta(req));
  }

  @Patch('addons/:id')
  updateAddon(
    @Param('id', uuid) id: string,
    @Body({ schema: updateAddonSchema }) body: z.output<typeof updateAddonSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.plans.updateAddon(auth, id, body, requestMeta(req));
  }
}

/** Organisations' subscriptions. Platform administrators only. */
@ApiTags('platform')
@RequirePlatformAdmin()
@Controller('v1/platform/tenants')
export class PlatformSubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @ApiOperation({ summary: 'Every organisation with its plan and subscription status' })
  list(@CurrentAuth() auth: AuthContext) {
    return this.subscriptions.listTenants(auth);
  }

  @Get(':tenantId/subscription')
  @ApiOperation({ summary: 'Subscription, add-ons, overrides, history, entitlements and usage' })
  get(@Param('tenantId', uuid) tenantId: string, @CurrentAuth() auth: AuthContext) {
    return this.subscriptions.get(auth, tenantId);
  }

  @Put(':tenantId/subscription')
  @ApiOperation({ summary: 'Start a subscription or change plan' })
  assign(
    @Param('tenantId', uuid) tenantId: string,
    @Body({ schema: assignSubscriptionSchema }) body: z.output<typeof assignSubscriptionSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.subscriptions.assign(auth, tenantId, body, requestMeta(req));
  }

  @Post(':tenantId/subscription/actions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renew, mark past due, suspend, reactivate or cancel' })
  act(
    @Param('tenantId', uuid) tenantId: string,
    @Body({ schema: subscriptionActionSchema }) body: z.output<typeof subscriptionActionSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.subscriptions.act(auth, tenantId, body, requestMeta(req));
  }

  @Put(':tenantId/subscription/addons')
  @ApiOperation({ summary: 'Set an add-on’s quantity (0 removes it)' })
  setAddon(
    @Param('tenantId', uuid) tenantId: string,
    @Body({ schema: setSubscriptionAddonSchema }) body: z.output<typeof setSubscriptionAddonSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.subscriptions.setAddon(auth, tenantId, body, requestMeta(req));
  }

  @Post(':tenantId/overrides')
  @ApiOperation({ summary: 'Grant or remove a feature, or set a limit, for one organisation' })
  override(
    @Param('tenantId', uuid) tenantId: string,
    @Body({ schema: createOverrideSchema }) body: z.output<typeof createOverrideSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.subscriptions.createOverride(auth, tenantId, body, requestMeta(req));
  }

  @Post(':tenantId/overrides/:id/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(
    @Param('tenantId', uuid) tenantId: string,
    @Param('id', uuid) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.subscriptions.revokeOverride(auth, tenantId, id, requestMeta(req));
  }
}
