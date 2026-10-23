import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  billListSchema,
  billSchema,
  payablesAgeingQuerySchema,
  salesCompanyQuerySchema,
  salesStatementQuerySchema,
  updateBillSchema,
  vendorPaymentSchema,
} from '@smart-hr/validation';
import { z } from 'zod';
import { CurrentAuth, CurrentTenant, RequireFeature, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { PurchasesService } from './purchases.service.js';

const id = () => new ParseUUIDPipe();
const paymentListQuery = z.object({ companyId: z.uuid(), vendorId: z.uuid().optional() });

/** Vendor bills, debit notes, payments to vendors, and payables reports. */
@ApiTags('purchases')
@RequireFeature('finance')
@Controller('v1/finance/purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get('bills')
  @RequirePermission('finance.view')
  bills(
    @Query({ schema: billListSchema }) q: z.output<typeof billListSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.purchases.bills(tenant, auth, q);
  }

  @Post('bills')
  @RequirePermission('finance.manage')
  createBill(
    @Body({ schema: billSchema }) body: z.output<typeof billSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.purchases.createBill(tenant, auth, body, requestMeta(req));
  }

  @Get('bills/:id')
  @RequirePermission('finance.view')
  bill(
    @Param('id', id()) billId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.purchases.bill(tenant, auth, billId);
  }

  @Put('bills/:id')
  @RequirePermission('finance.manage')
  updateBill(
    @Param('id', id()) billId: string,
    @Body({ schema: updateBillSchema }) body: z.output<typeof updateBillSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.purchases.updateBill(tenant, auth, billId, body, requestMeta(req));
  }

  @Post('bills/:id/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('finance.manage')
  @ApiOperation({ summary: 'Number a bill or debit note and post it to the books' })
  post(
    @Param('id', id()) billId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.purchases.post(tenant, auth, billId, requestMeta(req));
  }

  @Post('bills/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('finance.manage')
  cancel(
    @Param('id', id()) billId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.purchases.cancel(tenant, auth, billId, requestMeta(req));
  }

  @Post('bills/:id/debit-note')
  @RequirePermission('finance.manage')
  @ApiOperation({ summary: 'Start a debit note against a posted bill' })
  debitNote(
    @Param('id', id()) billId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.purchases.debitNote(tenant, auth, billId, requestMeta(req));
  }

  @Get('payments')
  @RequirePermission('finance.view')
  payments(
    @Query({ schema: paymentListQuery }) q: z.output<typeof paymentListQuery>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.purchases.payments(tenant, auth, q.companyId, q.vendorId);
  }

  @Post('payments')
  @RequirePermission('finance.manage')
  @ApiOperation({ summary: 'Record a payment to a vendor; settles bills and posts to the books' })
  recordPayment(
    @Body({ schema: vendorPaymentSchema }) body: z.output<typeof vendorPaymentSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.purchases.recordPayment(tenant, auth, body, requestMeta(req));
  }

  @Get('summary')
  @RequirePermission('finance.view')
  summary(
    @Query({ schema: salesCompanyQuerySchema }) q: z.output<typeof salesCompanyQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.purchases.summary(tenant, auth, q.companyId);
  }

  @Get('ageing')
  @RequirePermission('finance.view')
  ageing(
    @Query({ schema: payablesAgeingQuerySchema }) q: z.output<typeof payablesAgeingQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.purchases.ageing(tenant, auth, q.companyId, q.asOf);
  }

  @Get('vendors/:id/statement')
  @RequirePermission('finance.view')
  statement(
    @Param('id', id()) vendorId: string,
    @Query({ schema: salesStatementQuerySchema }) q: z.output<typeof salesStatementQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.purchases.statement(tenant, auth, vendorId, q.companyId, q.from, q.to);
  }
}
