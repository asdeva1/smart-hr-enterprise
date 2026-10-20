import { Module, type OnModuleInit } from '@nestjs/common';
import { TenantExportService } from '../tenant/export.service.js';
import { AttendanceController } from './attendance.controller.js';
import { BiometricController, IclockController } from './biometric.controller.js';
import { BiometricIngestService } from './biometric-ingest.service.js';
import { BiometricService } from './biometric.service.js';
import { AttendanceService } from './attendance.service.js';
import { CorrectionsService } from './corrections.service.js';
import { ShiftsService } from './shifts.service.js';

@Module({
  controllers: [AttendanceController, BiometricController, IclockController],
  providers: [AttendanceService, ShiftsService, CorrectionsService, BiometricService, BiometricIngestService],
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
    this.exporter.register('biometricDevices', (tx) =>
      tx.biometricDevice.findMany({ orderBy: { name: 'asc' } }),
    );
    this.exporter.register('biometricEnrollments', (tx) =>
      tx.biometricEnrollment.findMany({ orderBy: { deviceCode: 'asc' } }),
    );
    this.exporter.register('attendanceCorrections', (tx) =>
      tx.attendanceCorrection.findMany({ orderBy: [{ employeeId: 'asc' }, { date: 'asc' }] }),
    );
  }
}
