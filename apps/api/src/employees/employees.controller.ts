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
  createEmployeeSchema,
  emergencyContactSchema,
  employeeImportSchema,
  employeeLifecycleSchema,
  employeeListQuerySchema,
  employeeSensitiveSchema,
  inviteEmployeeSchema,
  updateEmployeeSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import {
  CurrentAuth,
  CurrentTenant,
  RequireFeature,
  RequirePermission,
  RequireRecentAuth,
} from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { EmployeeAccountService } from './employee-account.service.js';
import { EmployeeImportService } from './employee-import.service.js';
import { EmployeeSensitiveService } from './employee-sensitive.service.js';
import { EmployeesService } from './employees.service.js';

/**
 * Employee records. The guard checks the permission is held somewhere and that the plan includes employee
 * records (writes stop if the subscription lapses); the services check the scope of each employee.
 */
@ApiTags('employees')
@RequireFeature('hr.core')
@Controller('v1/employees')
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly sensitive: EmployeeSensitiveService,
    private readonly imports: EmployeeImportService,
    private readonly accounts: EmployeeAccountService,
  ) {}

  @Get()
  @RequirePermission('employees.view')
  @ApiOperation({ summary: 'Employees the member can see, filtered and paged' })
  list(
    @Query({ schema: employeeListQuerySchema }) query: z.output<typeof employeeListQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.employees.list(tenant, auth, query);
  }

  @Get('org-chart')
  @RequirePermission('employees.view')
  @ApiOperation({ summary: 'Current employees the member can see, with their managers' })
  orgChart(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.employees.orgChart(tenant, auth);
  }

  @Post()
  @RequirePermission('employees.manage')
  @ApiOperation({ summary: 'Add an employee (numbered automatically when no code is given)' })
  create(
    @Body({ schema: createEmployeeSchema }) body: z.output<typeof createEmployeeSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.employees.create(tenant, auth, body, requestMeta(req));
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('employees.manage')
  @ApiOperation({ summary: 'Check (dryRun) or import employees from CSV; all rows or none' })
  import(
    @Body({ schema: employeeImportSchema }) body: z.output<typeof employeeImportSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.imports.run(tenant, auth, body.csv, body.dryRun, requestMeta(req));
  }

  @Get(':id')
  @RequirePermission('employees.view')
  @ApiOperation({ summary: 'One employee, with what the member may do to them' })
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.employees.get(tenant, auth, id);
  }

  @Patch(':id')
  @RequirePermission('employees.manage')
  @ApiOperation({ summary: 'Correct personal and employment details (send the version you read)' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: updateEmployeeSchema }) body: z.output<typeof updateEmployeeSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.employees.update(tenant, auth, id, body, requestMeta(req));
  }

  @Post(':id/lifecycle')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('employees.lifecycle')
  @ApiOperation({
    summary: 'Transfer, promote, change manager, record notice, withdraw notice or record an exit',
  })
  lifecycle(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: employeeLifecycleSchema }) body: z.output<typeof employeeLifecycleSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.employees.lifecycle(tenant, auth, id, body, requestMeta(req));
  }

  @Get(':id/history')
  @RequirePermission('employees.view')
  @ApiOperation({ summary: 'Employment history, newest first' })
  history(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.employees.history(tenant, auth, id);
  }

  @Post(':id/sign-in')
  @RequirePermission('employees.manage', 'access.manage')
  @ApiOperation({ summary: 'Invite the employee to sign in, using their work email' })
  invite(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: inviteEmployeeSchema }) body: z.output<typeof inviteEmployeeSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.accounts.invite(tenant, auth, id, body.roleId, requestMeta(req));
  }

  // ---- Identity and bank details ----

  @Get(':id/sensitive')
  @RequirePermission('employees.sensitive.view')
  @ApiOperation({ summary: 'Identity and bank details, masked' })
  maskedSensitive(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.sensitive.masked(tenant, auth, id);
  }

  @Post(':id/sensitive/reveal')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('employees.sensitive.view')
  @RequireRecentAuth()
  @ApiOperation({ summary: 'Full identity and bank details (recent password entry; audited)' })
  reveal(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.sensitive.reveal(tenant, auth, id, requestMeta(req));
  }

  @Put(':id/sensitive')
  @RequirePermission('employees.sensitive.manage')
  @RequireRecentAuth()
  @ApiOperation({ summary: 'Change identity and bank details (omitted fields stay; null clears)' })
  updateSensitive(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: employeeSensitiveSchema }) body: z.output<typeof employeeSensitiveSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.sensitive.update(tenant, auth, id, body, requestMeta(req));
  }

  // ---- Emergency contacts ----

  @Get(':id/contacts')
  @RequirePermission('employees.view')
  contacts(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.employees.contacts(tenant, auth, id);
  }

  @Post(':id/contacts')
  @RequirePermission('employees.manage')
  addContact(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: emergencyContactSchema }) body: z.output<typeof emergencyContactSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.employees.saveContact(tenant, auth, id, null, body, requestMeta(req));
  }

  @Put(':id/contacts/:contactId')
  @RequirePermission('employees.manage')
  updateContact(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
    @Body({ schema: emergencyContactSchema }) body: z.output<typeof emergencyContactSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.employees.saveContact(tenant, auth, id, contactId, body, requestMeta(req));
  }

  @Delete(':id/contacts/:contactId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('employees.manage')
  async deleteContact(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    await this.employees.deleteContact(tenant, auth, id, contactId, requestMeta(req));
  }
}
