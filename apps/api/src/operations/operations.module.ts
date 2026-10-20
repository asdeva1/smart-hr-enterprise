import { Module, type OnModuleInit } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { TenantExportService } from '../tenant/export.service.js';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';

@Module({
  imports: [AttendanceModule],
  controllers: [OperationsController],
  providers: [OperationsService],
})
export class OperationsModule implements OnModuleInit {
  constructor(private readonly exporter: TenantExportService) {}

  /** Workspaces (with their stages and fields), items and item history are part of the organisation's data export. */
  onModuleInit(): void {
    this.exporter.register('opsWorkspaces', (tx) =>
      tx.opsWorkspace.findMany({
        orderBy: { code: 'asc' },
        include: { stages: { orderBy: { position: 'asc' } }, fields: { orderBy: { position: 'asc' } } },
      }),
    );
    this.exporter.register('opsItems', (tx) =>
      tx.opsItem.findMany({ orderBy: { createdAt: 'asc' }, take: 200_000 }),
    );
    this.exporter.register('opsItemEvents', (tx) =>
      tx.opsItemEvent.findMany({ orderBy: { createdAt: 'asc' }, take: 500_000 }),
    );
  }
}
