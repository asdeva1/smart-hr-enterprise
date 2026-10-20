import { Module, type OnModuleInit } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { TenantExportService } from '../tenant/export.service.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';

@Module({
  imports: [AttendanceModule],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule implements OnModuleInit {
  constructor(private readonly exporter: TenantExportService) {}

  /** Items, warehouses and the stock ledger are part of the organisation's data export. */
  onModuleInit(): void {
    this.exporter.register('warehouses', (tx) => tx.warehouse.findMany({ orderBy: { code: 'asc' } }));
    this.exporter.register('inventoryItems', (tx) => tx.inventoryItem.findMany({ orderBy: { sku: 'asc' } }));
    this.exporter.register('stockMovements', (tx) =>
      tx.stockMovement.findMany({ orderBy: { createdAt: 'asc' }, take: 500_000 }),
    );
  }
}
