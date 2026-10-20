import { Module, type OnModuleInit } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { TenantExportService } from '../tenant/export.service.js';
import { HolidaysService } from './holidays.service.js';
import { HolidaysController, LeaveController } from './leave.controller.js';
import { LeaveService } from './leave.service.js';

@Module({
  imports: [AttendanceModule],
  controllers: [LeaveController, HolidaysController],
  providers: [LeaveService, HolidaysService],
  exports: [LeaveService, HolidaysService],
})
export class LeaveModule implements OnModuleInit {
  constructor(private readonly exporter: TenantExportService) {}

  /** Holidays and leave are part of the organisation's data export. */
  onModuleInit(): void {
    this.exporter.register('holidayCalendars', (tx) =>
      tx.holidayCalendar.findMany({ orderBy: { name: 'asc' } }),
    );
    this.exporter.register('holidays', (tx) =>
      tx.holiday.findMany({ orderBy: [{ calendarId: 'asc' }, { date: 'asc' }] }),
    );
    this.exporter.register('leaveTypes', (tx) => tx.leaveType.findMany({ orderBy: { code: 'asc' } }));
    this.exporter.register('leaveLedger', (tx) =>
      tx.leaveLedgerEntry.findMany({ orderBy: [{ employeeId: 'asc' }, { createdAt: 'asc' }], take: 500_000 }),
    );
    this.exporter.register('leaveRequests', (tx) =>
      tx.leaveRequest.findMany({ orderBy: [{ employeeId: 'asc' }, { fromDate: 'asc' }] }),
    );
  }
}
