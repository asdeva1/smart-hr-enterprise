import { Module, type OnModuleInit } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { TenantExportService } from '../tenant/export.service.js';
import { EmployeeAccountService } from './employee-account.service.js';
import { EmployeeImportService } from './employee-import.service.js';
import { EmployeeSensitiveService } from './employee-sensitive.service.js';
import { EmployeeChangesService } from './employee-changes.service.js';
import { EmployeeChangesController, EmployeesController } from './employees.controller.js';
import { EmployeesService } from './employees.service.js';

@Module({
  imports: [AccessModule],
  controllers: [EmployeesController, EmployeeChangesController],
  providers: [
    EmployeesService,
    EmployeeSensitiveService,
    EmployeeImportService,
    EmployeeAccountService,
    EmployeeChangesService,
  ],
  exports: [EmployeesService],
})
export class EmployeesModule implements OnModuleInit {
  constructor(
    private readonly exporter: TenantExportService,
    private readonly sensitive: EmployeeSensitiveService,
  ) {}

  /** Employee data is part of the organisation's export, identity and bank numbers included. */
  onModuleInit(): void {
    this.exporter.register('employees', (tx) => tx.employee.findMany({ orderBy: { employeeCode: 'asc' } }));
    this.exporter.register('employeeHistory', (tx) =>
      tx.employeeEvent.findMany({ orderBy: [{ employeeId: 'asc' }, { effectiveDate: 'asc' }] }),
    );
    this.exporter.register('employmentChangeRequests', (tx) =>
      tx.employeeChangeRequest.findMany({ orderBy: [{ employeeId: 'asc' }, { createdAt: 'asc' }] }),
    );
    this.exporter.register('emergencyContacts', (tx) =>
      tx.emergencyContact.findMany({ orderBy: { employeeId: 'asc' } }),
    );
    this.exporter.register('employeeIdentityAndBank', async (tx) => {
      const rows = await tx.employeeSensitive.findMany({ orderBy: { employeeId: 'asc' } });
      return rows.map((row) => ({
        employeeId: row.employeeId,
        tenantId: row.tenantId,
        ...this.sensitive.decryptForExport(row),
        bankIfsc: row.bankIfsc,
        bankName: row.bankName,
        uan: row.uan,
        updatedAt: row.updatedAt,
      }));
    });
  }
}
