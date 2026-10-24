import { Module, type OnModuleInit } from '@nestjs/common';
import { TenantExportService } from '../tenant/export.service.js';
import { AdvancedAttendanceService } from './advanced-attendance.service.js';
import { AdvancedAttendanceController, AttendanceController } from './attendance.controller.js';
import { BiometricController, IclockController } from './biometric.controller.js';
import { BiometricIngestService } from './biometric-ingest.service.js';
import { BiometricService } from './biometric.service.js';
import { AttendanceService } from './attendance.service.js';
import { CorrectionsService } from './corrections.service.js';
import { ShiftsService } from './shifts.service.js';

@Module({
  controllers: [AttendanceController, AdvancedAttendanceController, BiometricController, IclockController],
  providers: [
    AttendanceService,
    AdvancedAttendanceService,
    ShiftsService,
    CorrectionsService,
    BiometricService,
    BiometricIngestService,
  ],
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
    this.exporter.register('attendancePolicy', (tx) => tx.attendancePolicy.findMany());
    this.exporter.register('workLocations', (tx) => tx.workLocation.findMany({ orderBy: { name: 'asc' } }));
    this.exporter.register('rosterEntries', (tx) =>
      tx.rosterEntry.findMany({ orderBy: [{ employeeId: 'asc' }, { date: 'asc' }], take: 500_000 }),
    );
    this.exporter.register('overtimeApprovals', (tx) =>
      tx.overtimeApproval.findMany({ orderBy: [{ employeeId: 'asc' }, { date: 'asc' }] }),
    );
    this.exporter.register('attendanceCorrections', (tx) =>
      tx.attendanceCorrection.findMany({ orderBy: [{ employeeId: 'asc' }, { date: 'asc' }] }),
    );
  }
}
