import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  approvalDecisionSchema,
  approvalListQuerySchema,
  createApprovalPolicySchema,
  delegationSchema,
} from '@smart-hr/validation';
import { z } from 'zod';
import { CurrentAuth, CurrentTenant, RequirePermission, RequireTenant } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { ApprovalsService } from './approvals.service.js';

const colleagueQuery = z.object({ search: z.string().trim().max(100).default('') });

/**
 * Approvals. Acting on a task needs no permission: being its assignee is the authority, checked by the engine.
 * Seeing others' requests needs approvals.view_all at a covering scope; policies need approvals.manage.
 */
@ApiTags('approvals')
@RequireTenant()
@Controller('v1/approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get('inbox')
  @ApiOperation({ summary: 'Approvals waiting on me' })
  inbox(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.approvals.inbox(tenant, auth);
  }

  @Get('requests')
  @ApiOperation({ summary: 'Requests I submitted, or every request in my scope (approvals.view_all)' })
  list(
    @Query({ schema: approvalListQuerySchema }) query: z.output<typeof approvalListQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.approvals.listRequests(tenant, auth, query);
  }

  @Get('requests/:id')
  @ApiOperation({ summary: 'One request with its stages and decisions' })
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.approvals.getRequest(tenant, auth, id);
  }

  @Post('tasks/:id/decision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve, reject or send back' })
  decide(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: approvalDecisionSchema }) body: z.output<typeof approvalDecisionSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.approvals.decide(tenant, auth, id, body, requestMeta(req));
  }

  @Post('requests/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw my request' })
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.approvals.cancel(tenant, auth, id, requestMeta(req));
  }

  @Post('requests/:id/resubmit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resubmit my request after it was sent back' })
  resubmit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.approvals.resubmit(tenant, auth, id, requestMeta(req));
  }

  @Get('policies')
  @RequirePermission('approvals.manage')
  @ApiOperation({ summary: 'Approval policy for each kind of request' })
  policies(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.approvals.listPolicies(tenant, auth);
  }

  @Post('policies')
  @RequirePermission('approvals.manage')
  @ApiOperation({ summary: 'Publish a new policy version' })
  createPolicy(
    @Body({ schema: createApprovalPolicySchema }) body: z.output<typeof createApprovalPolicySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.approvals.createPolicy(tenant, auth, body, requestMeta(req));
  }

  @Get('colleagues')
  @ApiOperation({ summary: 'Colleagues I can hand my approvals to (names only)' })
  colleagues(
    @Query({ schema: colleagueQuery }) query: z.output<typeof colleagueQuery>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.approvals.colleagues(tenant, auth, query.search);
  }

  @Get('delegations')
  @ApiOperation({ summary: 'My current and upcoming delegations, given and received' })
  delegations(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.approvals.listDelegations(tenant, auth);
  }

  @Post('delegations')
  @ApiOperation({ summary: 'Hand my approvals to someone while I’m away' })
  createDelegation(
    @Body({ schema: delegationSchema }) body: z.output<typeof delegationSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.approvals.createDelegation(tenant, auth, body, requestMeta(req));
  }

  @Delete('delegations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End a delegation I gave' })
  async revokeDelegation(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    await this.approvals.revokeDelegation(tenant, auth, id, requestMeta(req));
  }
}
