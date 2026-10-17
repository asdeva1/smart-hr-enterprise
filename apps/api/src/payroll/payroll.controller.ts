import {
  Body,
  Controller,
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
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppError } from '@smart-hr/shared';
import {
  employeePayrollSchema,
  payComponentSchema,
  payrollListQuerySchema,
  payrollRunSchema,
  payrollSettingSchema,
  payslipInputSchema,
  professionalTaxSchema,
  salarySchema,
  updatePayComponentSchema,
} from '@smart-hr/validation';
import type { Response } from 'express';
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
import { contentDisposition } from '../documents/file-types.js';
import { PayrollRunsService } from './payroll-runs.service.js';
import { PayrollSetupService } from './payroll-setup.service.js';

const id = () => new ParseUUIDPipe();

function send(res: Response, file: { data: Buffer; fileName: string; mimeType: string }) {
  res.set({
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  });
  return new StreamableFile(file.data, {
    type: file.mimeType,
    disposition: contentDisposition(file.fileName),
    length: file.data.length,
  });
}

function state(value: string) {
  if (!/^[A-Z]{2}$/.test(value))
    throw new AppError('VALIDATION_FAILED', 'Use the two-letter state code', 400);
  return value;
}

@ApiTags('payroll')
@RequireFeature('payroll')
@Controller('v1/payroll')
export class PayrollController {
  constructor(
    private readonly setup: PayrollSetupService,
    private readonly runs: PayrollRunsService,
  ) {}

  // ---- Set-up -----------------------------------------------------------------------------------

  @Get('components')
  components(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.setup.components(tenant, auth);
  }

  @Post('components')
  @RequirePermission('payroll.configure')
  createComponent(
    @Body({ schema: payComponentSchema }) body: z.output<typeof payComponentSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.setup.createComponent(tenant, auth, body, requestMeta(req));
  }

  @Patch('components/:id')
  @RequirePermission('payroll.configure')
  updateComponent(
    @Param('id', id()) componentId: string,
    @Body({ schema: updatePayComponentSchema }) body: z.output<typeof updatePayComponentSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.setup.updateComponent(tenant, auth, componentId, body, requestMeta(req));
  }

  @Get('settings/:companyId')
  settings(
    @Param('companyId', id()) companyId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.setup.settings(tenant, auth, companyId);
  }

  @Put('settings/:companyId')
  @RequirePermission('payroll.configure')
  @ApiOperation({ summary: 'PF and ESI switches and registrations for a company' })
  saveSettings(
    @Param('companyId', id()) companyId: string,
    @Body({ schema: payrollSettingSchema }) body: z.output<typeof payrollSettingSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.setup.saveSettings(tenant, auth, companyId, body, requestMeta(req));
  }

  @Get('professional-tax')
  ptTables(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.setup.ptTables(tenant, auth);
  }

  @Put('professional-tax/:state')
  @RequirePermission('payroll.configure')
  savePt(
    @Param('state') st: string,
    @Body({ schema: professionalTaxSchema }) body: z.output<typeof professionalTaxSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.setup.savePtTable(tenant, auth, state(st), body, requestMeta(req));
  }

  @Get('employees/:id')
  @RequirePermission('payroll.view')
  @ApiOperation({ summary: 'An employee’s statutory choices and salary history' })
  employee(
    @Param('id', id()) employeeId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.setup.employee(tenant, auth, employeeId);
  }

  @Put('employees/:id/profile')
  @RequirePermission('payroll.manage')
  saveProfile(
    @Param('id', id()) employeeId: string,
    @Body({ schema: employeePayrollSchema }) body: z.output<typeof employeePayrollSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.setup.saveProfile(tenant, auth, employeeId, body, requestMeta(req));
  }

  @Post('employees/:id/salaries')
  @RequirePermission('payroll.manage')
  @ApiOperation({ summary: 'Add a salary revision (effective from a date; never rewritten)' })
  addSalary(
    @Param('id', id()) employeeId: string,
    @Body({ schema: salarySchema }) body: z.output<typeof salarySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.setup.addSalary(tenant, auth, employeeId, body, requestMeta(req));
  }

  // ---- Runs -------------------------------------------------------------------------------------

  @Get('runs')
  @RequirePermission('payroll.view')
  list(
    @Query({ schema: payrollListQuerySchema }) q: z.output<typeof payrollListQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.runs.list(tenant, auth, q);
  }

  @Post('runs')
  @RequirePermission('payroll.manage')
  @ApiOperation({ summary: 'Start a month’s payroll for a company (calculated straight away)' })
  create(
    @Body({ schema: payrollRunSchema }) body: z.output<typeof payrollRunSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.runs.create(tenant, auth, body, requestMeta(req));
  }

  @Get('runs/:id')
  get(
    @Param('id', id()) runId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.runs.get(tenant, auth, runId);
  }

  @Post('runs/:id/recalculate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('payroll.manage')
  recalculate(
    @Param('id', id()) runId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.runs.recalculate(tenant, auth, runId, requestMeta(req));
  }

  @Post('runs/:id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('payroll.manage')
  @ApiOperation({ summary: 'Recalculate and send for approval' })
  submit(
    @Param('id', id()) runId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.runs.submit(tenant, auth, runId, requestMeta(req));
  }

  @Post('runs/:id/paid')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('payroll.manage')
  markPaid(
    @Param('id', id()) runId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.runs.markPaid(tenant, auth, runId, requestMeta(req));
  }

  @Post('runs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('payroll.manage')
  cancel(
    @Param('id', id()) runId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.runs.cancel(tenant, auth, runId, requestMeta(req));
  }

  @Get('runs/:id/register.csv')
  @RequirePermission('payroll.manage')
  async register(
    @Param('id', id()) runId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(res, await this.runs.register(tenant, auth, runId, requestMeta(req)));
  }

  @Get('runs/:id/bank.csv')
  @RequirePermission('payroll.manage')
  @RequireRecentAuth()
  @ApiOperation({ summary: 'Salary transfer list with account numbers (recent password entry; audited)' })
  async bank(
    @Param('id', id()) runId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(res, await this.runs.bankFile(tenant, auth, runId, requestMeta(req)));
  }

  @Get('runs/:id/pf-ecr.txt')
  @RequirePermission('payroll.manage')
  @RequireFeature('payroll.statutory_in')
  @ApiOperation({ summary: 'EPFO ECR file for the month' })
  async ecr(
    @Param('id', id()) runId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(res, await this.runs.pfEcr(tenant, auth, runId, requestMeta(req)));
  }

  @Patch('payslips/:id')
  @RequirePermission('payroll.manage')
  @ApiOperation({ summary: 'Correct a draft payslip (loss of pay, one-off lines); the run is recalculated' })
  editPayslip(
    @Param('id', id()) payslipId: string,
    @Body({ schema: payslipInputSchema }) body: z.output<typeof payslipInputSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.runs.editPayslip(tenant, auth, payslipId, body, requestMeta(req));
  }

  @Get('me/payslips')
  @ApiOperation({ summary: 'My approved payslips' })
  mine(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.runs.mine(tenant, auth);
  }

  @Get('payslips/:id')
  payslip(
    @Param('id', id()) payslipId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.runs.payslip(tenant, auth, payslipId);
  }

  @Get('payslips/:id/pdf')
  async pdf(
    @Param('id', id()) payslipId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(res, await this.runs.payslipPdf(tenant, auth, payslipId, requestMeta(req)));
  }
}
