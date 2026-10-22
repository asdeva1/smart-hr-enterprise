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
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  auditQuerySchema,
  createRoleSchema,
  inviteMemberSchema,
  memberListQuerySchema,
  roleAssignmentSchema,
  securityPolicySchema,
  updateMemberSchema,
  updateRoleSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { CurrentAuth, CurrentTenant, RequirePermission, RequireRecentAuth } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { AccessService } from './access.service.js';

/** People, roles, security policy and audit log of the active organisation. */
@ApiTags('administration')
@Controller('v1/admin')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  // ---- Members ----

  @Get('members')
  @RequirePermission('access.view')
  @ApiOperation({ summary: 'Members of the organisation with their roles' })
  listMembers(
    @Query({ schema: memberListQuerySchema }) query: z.output<typeof memberListQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.access.listMembers(tenant, auth, query);
  }

  @Get('members/:id')
  @RequirePermission('access.view')
  @ApiOperation({ summary: 'One member' })
  getMember(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.access.getMember(tenant, auth, id);
  }

  @Post('members')
  @RequireRecentAuth()
  @RequirePermission('access.manage')
  @ApiOperation({ summary: 'Invite someone (creates their account if needed) with optional roles' })
  invite(
    @Body({ schema: inviteMemberSchema }) body: z.output<typeof inviteMemberSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.access.invite(tenant, auth, body, requestMeta(req));
  }

  @Patch('members/:id')
  @RequireRecentAuth()
  @RequirePermission('access.manage')
  @ApiOperation({ summary: 'Suspend or reactivate a member; owners can grant or remove ownership' })
  updateMember(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: updateMemberSchema }) body: z.output<typeof updateMemberSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.access.updateMember(tenant, auth, id, body, requestMeta(req));
  }

  @Post('members/:id/invitation')
  @RequireRecentAuth()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('access.manage')
  @ApiOperation({ summary: 'Send a new invitation link to someone who has not set up their account' })
  async resendInvitation(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    await this.access.resendInvitation(tenant, auth, id, requestMeta(req));
    return { message: 'Invitation sent.' };
  }

  @Post('members/:id/password-reset')
  @RequireRecentAuth()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('access.manage')
  @ApiOperation({ summary: 'Email the member a password reset link' })
  async sendPasswordReset(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    await this.access.sendPasswordReset(tenant, auth, id, requestMeta(req));
    return { message: 'Password reset link sent.' };
  }

  @Post('members/:id/assignments')
  @RequireRecentAuth()
  @RequirePermission('access.manage')
  @ApiOperation({ summary: 'Give a member a role at a scope' })
  addAssignment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: roleAssignmentSchema }) body: z.output<typeof roleAssignmentSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.access.addAssignment(tenant, auth, id, body, requestMeta(req));
  }

  @Delete('members/:id/assignments/:assignmentId')
  @RequireRecentAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('access.manage')
  @ApiOperation({ summary: 'Remove a role from a member' })
  async removeAssignment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    await this.access.removeAssignment(tenant, auth, id, assignmentId, requestMeta(req));
  }

  // ---- Roles ----

  @Get('permissions')
  @RequirePermission('access.view')
  @ApiOperation({ summary: 'Every permission a role can contain' })
  permissions() {
    return this.access.permissionCatalogue();
  }

  @Get('roles')
  @RequirePermission('access.view')
  @ApiOperation({ summary: 'Roles of the organisation' })
  listRoles(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.access.listRoles(tenant, auth);
  }

  @Post('roles')
  @RequireRecentAuth()
  @RequirePermission('access.manage')
  @ApiOperation({ summary: 'Create a custom role' })
  createRole(
    @Body({ schema: createRoleSchema }) body: z.output<typeof createRoleSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.access.createRole(tenant, auth, body, requestMeta(req));
  }

  @Patch('roles/:id')
  @RequireRecentAuth()
  @RequirePermission('access.manage')
  @ApiOperation({ summary: 'Rename a custom role or change its permissions' })
  updateRole(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: updateRoleSchema }) body: z.output<typeof updateRoleSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.access.updateRole(tenant, auth, id, body, requestMeta(req));
  }

  @Delete('roles/:id')
  @RequireRecentAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('access.manage')
  @ApiOperation({ summary: 'Delete an unused custom role' })
  async deleteRole(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    await this.access.deleteRole(tenant, auth, id, requestMeta(req));
  }

  // ---- Security policy ----

  @Get('security')
  @RequirePermission('security.manage')
  @ApiOperation({ summary: 'Organisation security policy' })
  securityPolicy(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.access.securityPolicy(tenant, auth);
  }

  @Put('security')
  @RequireRecentAuth()
  @RequirePermission('security.manage')
  @ApiOperation({ summary: 'Change the organisation security policy' })
  updateSecurityPolicy(
    @Body({ schema: securityPolicySchema }) body: z.output<typeof securityPolicySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.access.updateSecurityPolicy(tenant, auth, body.requireMfa, requestMeta(req));
  }

  // ---- Audit ----

  @Get('audit')
  @RequirePermission('audit.view')
  @ApiOperation({ summary: 'Audit log of the organisation, newest first' })
  audit(
    @Query({ schema: auditQuerySchema }) query: z.output<typeof auditQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.access.auditLog(tenant, auth, query);
  }
}
