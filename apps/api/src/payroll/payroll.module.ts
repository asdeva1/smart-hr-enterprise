import { Module, type OnModuleInit } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module.js';
import { TenantExportService } from '../tenant/export.service.js';
import { PayrollController } from './payroll.controller.js';
import { PayrollRunsService } from './payroll-runs.service.js';
import { PayrollSetupService } from './payroll-setup.service.js';

@Module({
  imports: [EmployeesModule],
  controllers: [PayrollController],
  providers: [PayrollSetupService, PayrollRunsService],
})
export class PayrollModule implements OnModuleInit {
  constructor(private readonly exporter: TenantExportService) {}

  /** Payroll is part of the organisation's data export. */
  onModuleInit(): void {
    this.exporter.register('payComponents', (tx) => tx.payComponent.findMany({ orderBy: { code: 'asc' } }));
    this.exporter.register('employeeSalaries', (tx) =>
      tx.employeeSalary.findMany({ orderBy: [{ employeeId: 'asc' }, { effectiveFrom: 'asc' }] }),
    );
    this.exporter.register('employeePayroll', (tx) => tx.employeePayroll.findMany());
    this.exporter.register('payrollSettings', (tx) => tx.payrollSetting.findMany());
    this.exporter.register('professionalTaxTables', (tx) => tx.professionalTaxTable.findMany());
    this.exporter.register('payrollRuns', (tx) =>
      tx.payrollRun.findMany({ orderBy: [{ year: 'asc' }, { month: 'asc' }] }),
    );
    this.exporter.register('payslips', (tx) =>
      tx.payslip.findMany({ orderBy: { createdAt: 'asc' }, take: 500_000 }),
    );
  }
}
