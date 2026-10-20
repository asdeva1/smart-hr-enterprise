import { Module, type OnModuleInit } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { TenantExportService } from '../tenant/export.service.js';
import { ProcurementController } from './procurement.controller.js';
import { ProcurementService } from './procurement.service.js';

@Module({
  imports: [AttendanceModule],
  controllers: [ProcurementController],
  providers: [ProcurementService],
})
export class ProcurementModule implements OnModuleInit {
  constructor(private readonly exporter: TenantExportService) {}

  /** Purchase requests, orders and receipts are part of the organisation's data export. */
  onModuleInit(): void {
    this.exporter.register('purchaseRequests', (tx) =>
      tx.purchaseRequest.findMany({
        orderBy: { createdAt: 'asc' },
        include: { lines: { orderBy: { position: 'asc' } } },
        take: 200_000,
      }),
    );
    this.exporter.register('purchaseOrders', (tx) =>
      tx.purchaseOrder.findMany({
        orderBy: { createdAt: 'asc' },
        include: { lines: { orderBy: { position: 'asc' } } },
        take: 200_000,
      }),
    );
    this.exporter.register('goodsReceipts', (tx) =>
      tx.goodsReceipt.findMany({
        orderBy: { createdAt: 'asc' },
        include: { lines: true },
        take: 200_000,
      }),
    );
  }
}
