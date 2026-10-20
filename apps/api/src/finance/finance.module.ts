import { Module, type OnModuleInit } from '@nestjs/common';
import { PayrollModule } from '../payroll/payroll.module.js';
import { TenantExportService } from '../tenant/export.service.js';
import { BooksService } from './books.service.js';
import { FinanceController } from './finance.controller.js';
import { PayrollPostingService } from './payroll-posting.service.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [PayrollModule],
  controllers: [FinanceController],
  providers: [BooksService, ReportsService, PayrollPostingService],
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
  }
}
