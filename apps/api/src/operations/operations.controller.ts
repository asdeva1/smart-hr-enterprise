import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  definitionSchema,
  employeeSearchSchema,
  opsCommentSchema,
  opsItemListQuerySchema,
  opsItemSchema,
  opsTransitionSchema,
  updateOpsItemSchema,
  updateWorkspaceSchema,
  workspaceSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { CurrentAuth, CurrentTenant, RequireFeature, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { OperationsService } from './operations.service.js';

const id = () => new ParseUUIDPipe();

/** Static routes come before `:id`. */
@ApiTags('operations')
@RequireFeature('operations.templates', 'operations.custom')
@Controller('v1/operations')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get('templates')
  templates() {
    return this.operations.templates();
  }

  @Get('mine')
  mine(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.operations.mine(tenant, auth);
  }

  @Get('people')
  @RequirePermission('operations.contribute', 'operations.manage')
  people(
    @Query({ schema: employeeSearchSchema }) q: z.output<typeof employeeSearchSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.operations.people(tenant, auth, q.search);
  }

  @Get('workspaces')
  list(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.operations.list(tenant, auth);
  }

  @Post('workspaces')
  @RequirePermission('operations.manage')
  create(
    @Body({ schema: workspaceSchema }) body: z.output<typeof workspaceSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.operations.create(tenant, auth, body, requestMeta(req));
  }

  @Get('workspaces/:id')
  detail(
    @Param('id', id()) workspaceId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.operations.detail(tenant, auth, workspaceId);
  }

  @Patch('workspaces/:id')
  @RequirePermission('operations.manage')
  update(
    @Param('id', id()) workspaceId: string,
    @Body({ schema: updateWorkspaceSchema }) body: z.output<typeof updateWorkspaceSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.operations.update(tenant, auth, workspaceId, body, requestMeta(req));
  }

  @Put('workspaces/:id/definition')
  @RequirePermission('operations.manage')
  setDefinition(
    @Param('id', id()) workspaceId: string,
    @Body({ schema: definitionSchema }) body: z.output<typeof definitionSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.operations.setDefinition(tenant, auth, workspaceId, body, requestMeta(req));
  }

  @Get('workspaces/:id/items')
  items(
    @Param('id', id()) workspaceId: string,
    @Query({ schema: opsItemListQuerySchema }) q: z.output<typeof opsItemListQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.operations.items(tenant, auth, workspaceId, q);
  }

  @Post('workspaces/:id/items')
  createItem(
    @Param('id', id()) workspaceId: string,
    @Body({ schema: opsItemSchema }) body: z.output<typeof opsItemSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.operations.createItem(tenant, auth, workspaceId, body, requestMeta(req));
  }

  @Get('items/:id')
  itemDetail(
    @Param('id', id()) itemId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.operations.itemDetail(tenant, auth, itemId);
  }

  @Patch('items/:id')
  updateItem(
    @Param('id', id()) itemId: string,
    @Body({ schema: updateOpsItemSchema }) body: z.output<typeof updateOpsItemSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.operations.updateItem(tenant, auth, itemId, body, requestMeta(req));
  }

  @Post('items/:id/stage')
  transition(
    @Param('id', id()) itemId: string,
    @Body({ schema: opsTransitionSchema }) body: z.output<typeof opsTransitionSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.operations.transition(tenant, auth, itemId, body, requestMeta(req));
  }

  @Post('items/:id/comments')
  comment(
    @Param('id', id()) itemId: string,
    @Body({ schema: opsCommentSchema }) body: z.output<typeof opsCommentSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.operations.comment(tenant, auth, itemId, body);
  }
}
