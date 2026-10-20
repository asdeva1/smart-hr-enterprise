import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  purchaseOrderListQuerySchema,
  purchaseOrderSchema,
  purchaseRequestListQuerySchema,
  purchaseRequestSchema,
  receiveGoodsSchema,
  updatePurchaseOrderSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { CurrentAuth, CurrentTenant, RequireFeature, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { ProcurementService } from './procurement.service.js';

const id = () => new ParseUUIDPipe();

@ApiTags('procurement')
@RequireFeature('procurement')
@Controller('v1/procurement')
export class ProcurementController {
  constructor(private readonly procurement: ProcurementService) {}

  // ---- Purchase requests (any employee may ask) -----------------------------------------------

  @Get('requests')
  listRequests(
    @Query({ schema: purchaseRequestListQuerySchema }) q: z.output<typeof purchaseRequestListQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.procurement.listRequests(tenant, auth, q);
  }

  @Post('requests')
  createRequest(
    @Body({ schema: purchaseRequestSchema }) body: z.output<typeof purchaseRequestSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.procurement.createRequest(tenant, auth, body, requestMeta(req));
  }

  @Get('requests/:id')
  getRequest(
    @Param('id', id()) requestId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.procurement.getRequest(tenant, auth, requestId);
  }

  @Put('requests/:id')
  updateRequest(
    @Param('id', id()) requestId: string,
    @Body({ schema: purchaseRequestSchema }) body: z.output<typeof purchaseRequestSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.procurement.updateRequest(tenant, auth, requestId, body, requestMeta(req));
  }

  @Post('requests/:id/submit')
  submitRequest(
    @Param('id', id()) requestId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.procurement.submitRequest(tenant, auth, requestId, requestMeta(req));
  }

  @Post('requests/:id/cancel')
  cancelRequest(
    @Param('id', id()) requestId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.procurement.cancelRequest(tenant, auth, requestId, requestMeta(req));
  }

  // ---- Purchase orders ---------------------------------------------------------------------------

  @Get('orders')
  listOrders(
    @Query({ schema: purchaseOrderListQuerySchema }) q: z.output<typeof purchaseOrderListQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.procurement.listOrders(tenant, auth, q);
  }

  @Post('orders')
  @RequirePermission('procurement.manage')
  createOrder(
    @Body({ schema: purchaseOrderSchema }) body: z.output<typeof purchaseOrderSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.procurement.createOrder(tenant, auth, body, requestMeta(req));
  }

  @Get('orders/:id')
  getOrder(
    @Param('id', id()) orderId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.procurement.getOrder(tenant, auth, orderId);
  }

  @Put('orders/:id')
  @RequirePermission('procurement.manage')
  updateOrder(
    @Param('id', id()) orderId: string,
    @Body({ schema: updatePurchaseOrderSchema }) body: z.output<typeof updatePurchaseOrderSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.procurement.updateOrder(tenant, auth, orderId, body, requestMeta(req));
  }

  @Post('orders/:id/submit')
  @RequirePermission('procurement.manage')
  submitOrder(
    @Param('id', id()) orderId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.procurement.submitOrder(tenant, auth, orderId, requestMeta(req));
  }

  @Post('orders/:id/cancel')
  @RequirePermission('procurement.manage')
  cancelOrder(
    @Param('id', id()) orderId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.procurement.cancelOrder(tenant, auth, orderId, requestMeta(req));
  }

  @Post('orders/:id/receive')
  @RequirePermission('procurement.manage')
  receive(
    @Param('id', id()) orderId: string,
    @Body({ schema: receiveGoodsSchema }) body: z.output<typeof receiveGoodsSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.procurement.receive(tenant, auth, orderId, body, requestMeta(req));
  }
}
