import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { gstPeriodQuerySchema, gstr2bReconcileSchema } from '@smart-hr/validation';
import type { z } from 'zod';
import { CurrentAuth, CurrentTenant, RequireFeature, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { GstService } from './gst.service.js';

type Period = z.output<typeof gstPeriodQuerySchema>;

/** GST and TDS return data: GSTR-1, GSTR-3B summary, purchase register, GSTR-2B reconciliation, TDS report. */
@ApiTags('gst')
@RequireFeature('finance')
@Controller('v1/finance/gst')
export class GstController {
  constructor(private readonly gst: GstService) {}

  @Get('gstr1')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'GSTR-1 sections and HSN summary for a period' })
  gstr1(
    @Query({ schema: gstPeriodQuerySchema }) q: Period,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.gst.gstr1(tenant, auth, q);
  }

  @Get('gstr3b')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'Output tax less input tax credit for a period' })
  gstr3b(
    @Query({ schema: gstPeriodQuerySchema }) q: Period,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.gst.gstr3b(tenant, auth, q);
  }

  @Get('purchase-register')
  @RequirePermission('finance.view')
  purchaseRegister(
    @Query({ schema: gstPeriodQuerySchema }) q: Period,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.gst.purchaseRegister(tenant, auth, q);
  }

  @Get('tds')
  @RequirePermission('finance.view')
  tds(
    @Query({ schema: gstPeriodQuerySchema }) q: Period,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.gst.tds(tenant, auth, q);
  }

  @Post('gstr2b/reconcile')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'Match purchase bills against an uploaded GSTR-2B file; nothing is saved' })
  reconcile(
    @Body({ schema: gstr2bReconcileSchema }) body: z.output<typeof gstr2bReconcileSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.gst.reconcile(tenant, auth, body);
  }
}
