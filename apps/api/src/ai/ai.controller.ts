import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { aiPolicySchema, assistantSchema } from '@smart-hr/validation';
import type { z } from 'zod';
import { CurrentAuth, CurrentTenant, RequireFeature, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { AiFeaturesService } from './ai-features.service.js';
import { AiService } from './ai.service.js';

@ApiTags('ai')
@RequireFeature('ai.assistant')
@Controller('v1/ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly features: AiFeaturesService,
  ) {}

  @Get('status')
  status(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.ai.status(tenant, auth);
  }

  @Put('policy')
  @RequirePermission('settings.manage')
  setPolicy(
    @Body({ schema: aiPolicySchema }) body: z.output<typeof aiPolicySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.ai.setPolicy(tenant, auth, body, requestMeta(req));
  }

  @Get('usage')
  @RequireFeature('ai.governance')
  @RequirePermission('settings.manage')
  usage(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.ai.usage(tenant, auth);
  }

  @Post('assistant')
  assistant(
    @Body({ schema: assistantSchema }) body: z.output<typeof assistantSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.features.assistant(tenant, auth, body, requestMeta(req));
  }

  @Post('summaries/operations-items/:id')
  summariseItem(
    @Param('id', new ParseUUIDPipe()) itemId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.features.summariseOperationsItem(tenant, auth, itemId, requestMeta(req));
  }
}
