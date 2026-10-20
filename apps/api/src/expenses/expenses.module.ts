import { Module, type OnModuleInit } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { TenantExportService } from '../tenant/export.service.js';
import { ExpensesController, VendorsController } from './expenses.controller.js';
import { ExpensesService } from './expenses.service.js';
import { VendorsService } from './vendors.service.js';

@Module({
  imports: [AttendanceModule],
  controllers: [ExpensesController, VendorsController],
  providers: [ExpensesService, VendorsService],
})
export class ExpensesModule implements OnModuleInit {
  constructor(private readonly exporter: TenantExportService) {}

  /** Vendors and expense claims are part of the organisation's data export. */
  onModuleInit(): void {
    this.exporter.register('vendors', (tx) => tx.vendor.findMany({ orderBy: { code: 'asc' } }));
    this.exporter.register('expenseCategories', (tx) =>
      tx.expenseCategory.findMany({ orderBy: { code: 'asc' } }),
    );
    this.exporter.register('expenseClaims', (tx) =>
      tx.expenseClaim.findMany({
        orderBy: { createdAt: 'asc' },
        include: { lines: { orderBy: { position: 'asc' } } },
        take: 200_000,
      }),
    );
  }
}
