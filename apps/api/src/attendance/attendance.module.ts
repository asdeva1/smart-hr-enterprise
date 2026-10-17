import { Module, type OnModuleInit } from '@nestjs/common';
import { TenantExportService } from '../tenant/export.service.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';
import { CorrectionsService } from './corrections.service.js';
import { ShiftsService } from './shifts.service.js';

@Module({
  controllers: [AttendanceController],
  providers: [AttendanceService, ShiftsService, CorrectionsService],
  exports: [AttendanceService],
})
export class AttendanceModule implements OnModuleInit {
  constructor(private readonly exporter: TenantExportService) {}

  /** Attendance is part of the organisation's data export. */
  onModuleInit(): void {
    this.exporter.register('shifts', (tx) => tx.shift.findMany({ orderBy: { code: 'asc' } }));
    this.exporter.register('shiftAssignments', (tx) =>
      tx.shiftAssignment.findMany({ orderBy: [{ employeeId: 'asc' }, { effectiveFrom: 'asc' }] }),
    );
    this.exporter.register('attendancePunches', (tx) =>
      tx.attendancePunch.findMany({ orderBy: [{ employeeId: 'asc' }, { at: 'asc' }], take: 500_000 }),
    );
    this.exporter.register('attendanceDays', (tx) =>
      tx.attendanceDay.findMany({ orderBy: [{ employeeId: 'asc' }, { date: 'asc' }], take: 500_000 }),
    );
    this.exporter.register('attendanceCorrections', (tx) =>
      tx.attendanceCorrection.findMany({ orderBy: [{ employeeId: 'asc' }, { date: 'asc' }] }),
    );
  }
}
