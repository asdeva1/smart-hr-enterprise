import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createBranchSchema,
  createCompanySchema,
  createDepartmentSchema,
  orgListQuerySchema,
  updateBranchSchema,
  updateCompanySchema,
  updateDepartmentSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { CurrentAuth, CurrentTenant, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { OrgService } from './org.service.js';

type ListQuery = z.output<typeof orgListQuerySchema>;

/**
 * Organisation structure. The guard checks the permission exists somewhere in the tenant; the service
 * checks it covers the specific company, branch or department.
 */
@ApiTags('organisation')
@Controller('v1/org')
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Get('companies')
  @RequirePermission('org.view')
  @ApiOperation({ summary: 'Companies the caller can see' })
  listCompanies(
    @Query({ schema: orgListQuerySchema }) query: ListQuery,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.org.listCompanies(tenant, auth, query.status);
  }

  @Post('companies')
  @RequirePermission('org.manage')
  @ApiOperation({ summary: 'Create a company (tenant-wide org.manage)' })
  createCompany(
    @Body({ schema: createCompanySchema }) body: z.output<typeof createCompanySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.org.createCompany(tenant, auth, body, requestMeta(req));
  }

  @Patch('companies/:id')
  @RequirePermission('org.manage')
  @ApiOperation({ summary: 'Change or archive a company' })
  updateCompany(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: updateCompanySchema }) body: z.output<typeof updateCompanySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.org.updateCompany(tenant, auth, id, body, requestMeta(req));
  }

  @Get('branches')
  @RequirePermission('org.view')
  @ApiOperation({ summary: 'Branches the caller can see' })
  listBranches(
    @Query({ schema: orgListQuerySchema }) query: ListQuery,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.org.listBranches(tenant, auth, query.companyId, query.status);
  }

  @Post('branches')
  @RequirePermission('org.manage')
  @ApiOperation({ summary: 'Create a branch' })
  createBranch(
    @Body({ schema: createBranchSchema }) body: z.output<typeof createBranchSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.org.createBranch(tenant, auth, body, requestMeta(req));
  }

  @Patch('branches/:id')
  @RequirePermission('org.manage')
  @ApiOperation({ summary: 'Change or archive a branch' })
  updateBranch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: updateBranchSchema }) body: z.output<typeof updateBranchSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.org.updateBranch(tenant, auth, id, body, requestMeta(req));
  }

  @Get('departments')
  @RequirePermission('org.view')
  @ApiOperation({ summary: 'Departments the caller can see' })
  listDepartments(
    @Query({ schema: orgListQuerySchema }) query: ListQuery,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.org.listDepartments(tenant, auth, query.companyId, query.status);
  }

  @Post('departments')
  @RequirePermission('org.manage')
  @ApiOperation({ summary: 'Create a department' })
  createDepartment(
    @Body({ schema: createDepartmentSchema }) body: z.output<typeof createDepartmentSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.org.createDepartment(tenant, auth, body, requestMeta(req));
  }

  @Patch('departments/:id')
  @RequirePermission('org.manage')
  @ApiOperation({ summary: 'Rename, move or archive a department' })
  updateDepartment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: updateDepartmentSchema }) body: z.output<typeof updateDepartmentSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.org.updateDepartment(tenant, auth, id, body, requestMeta(req));
  }
}
