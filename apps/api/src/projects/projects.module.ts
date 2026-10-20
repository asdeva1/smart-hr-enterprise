import { Module, type OnModuleInit } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { TenantExportService } from '../tenant/export.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  imports: [AttendanceModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule implements OnModuleInit {
  constructor(private readonly exporter: TenantExportService) {}

  /** Projects, their teams and the time logged are part of the organisation's data export. */
  onModuleInit(): void {
    this.exporter.register('projects', (tx) =>
      tx.project.findMany({ orderBy: { code: 'asc' }, include: { members: true } }),
    );
    this.exporter.register('timeEntries', (tx) =>
      tx.timeEntry.findMany({ orderBy: { createdAt: 'asc' }, take: 500_000 }),
    );
  }
}
