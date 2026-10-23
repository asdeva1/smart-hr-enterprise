import { Module, type OnModuleInit } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { TenantExportService } from '../tenant/export.service.js';
import { PerformanceController } from './performance.controller.js';
import { PerformanceService } from './performance.service.js';

@Module({
  imports: [AttendanceModule],
  controllers: [PerformanceController],
  providers: [PerformanceService],
})
export class PerformanceModule implements OnModuleInit {
  constructor(private readonly exporter: TenantExportService) {}

  /** Cycles, goals, reviews and feedback are part of the organisation's data export. */
  onModuleInit(): void {
    this.exporter.register('reviewCycles', (tx) =>
      tx.reviewCycle.findMany({ orderBy: { periodFrom: 'asc' }, include: { goals: true, appraisals: true } }),
    );
    this.exporter.register('feedbackNotes', (tx) =>
      tx.feedbackNote.findMany({ orderBy: { createdAt: 'asc' }, take: 500_000 }),
    );
  }
}
