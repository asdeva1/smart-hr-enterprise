import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  inventoryItemSchema,
  movementQuerySchema,
  stockAdjustmentSchema,
  stockIssueSchema,
  stockQuerySchema,
  stockReceiptSchema,
  stockTransferSchema,
  updateInventoryItemSchema,
  updateWarehouseSchema,
  warehouseSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { CurrentAuth, CurrentTenant, RequireFeature, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { InventoryService } from './inventory.service.js';

const id = () => new ParseUUIDPipe();

@ApiTags('inventory')
@RequireFeature('inventory')
@Controller('v1/inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('warehouses')
  @RequirePermission('inventory.view')
  warehouses(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.inventory.warehouses(tenant, auth);
  }

  @Post('warehouses')
  @RequirePermission('inventory.manage')
  createWarehouse(
    @Body({ schema: warehouseSchema }) body: z.output<typeof warehouseSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.inventory.createWarehouse(tenant, auth, body, requestMeta(req));
  }

  @Patch('warehouses/:id')
  @RequirePermission('inventory.manage')
  updateWarehouse(
    @Param('id', id()) warehouseId: string,
    @Body({ schema: updateWarehouseSchema }) body: z.output<typeof updateWarehouseSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.inventory.updateWarehouse(tenant, auth, warehouseId, body, requestMeta(req));
  }

  @Get('items')
  @RequirePermission('inventory.view')
  items(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.inventory.items(tenant, auth);
  }

  @Post('items')
  @RequirePermission('inventory.manage')
  createItem(
    @Body({ schema: inventoryItemSchema }) body: z.output<typeof inventoryItemSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.inventory.createItem(tenant, auth, body, requestMeta(req));
  }

  @Get('items/:id')
  @RequirePermission('inventory.view')
  item(
    @Param('id', id()) itemId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.inventory.item(tenant, auth, itemId);
  }

  @Patch('items/:id')
  @RequirePermission('inventory.manage')
  updateItem(
    @Param('id', id()) itemId: string,
    @Body({ schema: updateInventoryItemSchema }) body: z.output<typeof updateInventoryItemSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.inventory.updateItem(tenant, auth, itemId, body, requestMeta(req));
  }

  @Get('stock')
  @RequirePermission('inventory.view')
  stock(
    @Query({ schema: stockQuerySchema }) q: z.output<typeof stockQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.inventory.stock(tenant, auth, q);
  }

  @Get('movements')
  @RequirePermission('inventory.view')
  movements(
    @Query({ schema: movementQuerySchema }) q: z.output<typeof movementQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.inventory.movements(tenant, auth, q);
  }

  @Post('receipts')
  @RequirePermission('inventory.manage')
  receive(
    @Body({ schema: stockReceiptSchema }) body: z.output<typeof stockReceiptSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.inventory.receive(tenant, auth, body, requestMeta(req));
  }

  @Post('issues')
  @RequirePermission('inventory.manage')
  issue(
    @Body({ schema: stockIssueSchema }) body: z.output<typeof stockIssueSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.inventory.issue(tenant, auth, body, requestMeta(req));
  }

  @Post('adjustments')
  @RequirePermission('inventory.manage')
  adjust(
    @Body({ schema: stockAdjustmentSchema }) body: z.output<typeof stockAdjustmentSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.inventory.adjust(tenant, auth, body, requestMeta(req));
  }

  @Post('transfers')
  @RequirePermission('inventory.manage')
  transfer(
    @Body({ schema: stockTransferSchema }) body: z.output<typeof stockTransferSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.inventory.transfer(tenant, auth, body, requestMeta(req));
  }
}
