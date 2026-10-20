import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  expenseCategorySchema,
  expenseClaimSchema,
  expenseListQuerySchema,
  payExpenseClaimSchema,
  updateExpenseCategorySchema,
  updateExpenseClaimSchema,
  updateVendorSchema,
  vendorListQuerySchema,
  vendorSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { CurrentAuth, CurrentTenant, RequireFeature, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { ExpensesService } from './expenses.service.js';
import { VendorsService } from './vendors.service.js';

const id = () => new ParseUUIDPipe();

@ApiTags('expenses')
@RequireFeature('expenses')
@Controller('v1/expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get('categories')
  @ApiOperation({ summary: 'Expense categories (everyone can see them to fill in a claim)' })
  categories(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.expenses.categories(tenant, auth);
  }

  @Post('categories')
  @RequirePermission('expenses.manage')
  createCategory(
    @Body({ schema: expenseCategorySchema }) body: z.output<typeof expenseCategorySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.expenses.createCategory(tenant, auth, body, requestMeta(req));
  }

  @Patch('categories/:id')
  @RequirePermission('expenses.manage')
  updateCategory(
    @Param('id', id()) categoryId: string,
    @Body({ schema: updateExpenseCategorySchema }) body: z.output<typeof updateExpenseCategorySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.expenses.updateCategory(tenant, auth, categoryId, body, requestMeta(req));
  }

  @Get('claims')
  @ApiOperation({ summary: 'Your claims, or all claims you can see (scope=all)' })
  list(
    @Query({ schema: expenseListQuerySchema }) q: z.output<typeof expenseListQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.expenses.list(tenant, auth, q);
  }

  @Post('claims')
  create(
    @Body({ schema: expenseClaimSchema }) body: z.output<typeof expenseClaimSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.expenses.create(tenant, auth, body, requestMeta(req));
  }

  @Get('claims/:id')
  get(
    @Param('id', id()) claimId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.expenses.get(tenant, auth, claimId);
  }

  @Put('claims/:id')
  update(
    @Param('id', id()) claimId: string,
    @Body({ schema: updateExpenseClaimSchema }) body: z.output<typeof updateExpenseClaimSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.expenses.update(tenant, auth, claimId, body, requestMeta(req));
  }

  @Post('claims/:id/submit')
  submit(
    @Param('id', id()) claimId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.expenses.submit(tenant, auth, claimId, requestMeta(req));
  }

  @Post('claims/:id/cancel')
  cancel(
    @Param('id', id()) claimId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.expenses.cancel(tenant, auth, claimId, requestMeta(req));
  }

  @Post('claims/:id/pay')
  @ApiOperation({ summary: 'Mark an approved claim as paid' })
  pay(
    @Param('id', id()) claimId: string,
    @Body({ schema: payExpenseClaimSchema }) body: z.output<typeof payExpenseClaimSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.expenses.markPaid(tenant, auth, claimId, body, requestMeta(req));
  }
}

@ApiTags('vendors')
@RequireFeature('vendors')
@Controller('v1/vendors')
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

  @Get()
  @RequirePermission('vendors.view')
  list(
    @Query({ schema: vendorListQuerySchema }) q: z.output<typeof vendorListQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.vendors.list(tenant, auth, q);
  }

  @Post()
  @RequirePermission('vendors.manage')
  create(
    @Body({ schema: vendorSchema }) body: z.output<typeof vendorSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.vendors.create(tenant, auth, body, requestMeta(req));
  }

  @Get(':id')
  @RequirePermission('vendors.view')
  get(
    @Param('id', id()) vendorId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.vendors.get(tenant, auth, vendorId);
  }

  @Patch(':id')
  @RequirePermission('vendors.manage')
  update(
    @Param('id', id()) vendorId: string,
    @Body({ schema: updateVendorSchema }) body: z.output<typeof updateVendorSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.vendors.update(tenant, auth, vendorId, body, requestMeta(req));
  }
}
