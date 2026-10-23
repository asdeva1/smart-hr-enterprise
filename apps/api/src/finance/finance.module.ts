import { Module, type OnModuleInit } from '@nestjs/common';
import { PayrollModule } from '../payroll/payroll.module.js';
import { TenantExportService } from '../tenant/export.service.js';
import { BooksService } from './books.service.js';
import { FinanceController } from './finance.controller.js';
import { PayrollPostingService } from './payroll-posting.service.js';
import { PurchasesController } from './purchases.controller.js';
import { PurchasesService } from './purchases.service.js';
import { ReportsService } from './reports.service.js';
import { SalesController } from './sales.controller.js';
import { SalesService } from './sales.service.js';

@Module({
  imports: [PayrollModule],
  controllers: [FinanceController, SalesController, PurchasesController],
  providers: [BooksService, ReportsService, PayrollPostingService, SalesService, PurchasesService],
})
export class FinanceModule implements OnModuleInit {
  constructor(private readonly exporter: TenantExportService) {}

  /** The books are part of the organisation's data export. */
  onModuleInit(): void {
    this.exporter.register('ledgerAccounts', (tx) =>
      tx.ledgerAccount.findMany({ orderBy: [{ companyId: 'asc' }, { code: 'asc' }] }),
    );
    this.exporter.register('journals', (tx) =>
      tx.journalEntry.findMany({
        orderBy: [{ companyId: 'asc' }, { date: 'asc' }],
        include: { lines: { orderBy: { position: 'asc' } } },
        take: 500_000,
      }),
    );
    this.exporter.register('bookLocks', (tx) => tx.bookLock.findMany());
    this.exporter.register('customers', (tx) => tx.customer.findMany({ orderBy: { code: 'asc' } }));
    this.exporter.register('salesDocuments', (tx) =>
      tx.salesDocument.findMany({ orderBy: { date: 'asc' }, include: { lines: true }, take: 200_000 }),
    );
    this.exporter.register('purchaseBills', (tx) =>
      tx.purchaseBill.findMany({ orderBy: { date: 'asc' }, include: { lines: true }, take: 200_000 }),
    );
    this.exporter.register('vendorPayments', (tx) =>
      tx.vendorPayment.findMany({ orderBy: { date: 'asc' }, include: { allocations: true }, take: 200_000 }),
    );
    this.exporter.register('customerReceipts', (tx) =>
      tx.customerReceipt.findMany({
        orderBy: { date: 'asc' },
        include: { allocations: true },
        take: 200_000,
      }),
    );
  }
}
