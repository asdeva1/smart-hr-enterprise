import { Module, type OnModuleInit } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { TenantExportService } from '../tenant/export.service.js';
import { AssetsController } from './assets.controller.js';
import { AssetsService } from './assets.service.js';

@Module({
  imports: [AttendanceModule],
  controllers: [AssetsController],
  providers: [AssetsService],
})
export class AssetsModule implements OnModuleInit {
  constructor(private readonly exporter: TenantExportService) {}

  /** The asset register and its assignment history are part of the organisation's data export. */
  onModuleInit(): void {
    this.exporter.register('assets', (tx) => tx.asset.findMany({ orderBy: { tag: 'asc' } }));
    this.exporter.register('assetAssignments', (tx) =>
      tx.assetAssignment.findMany({ orderBy: { createdAt: 'asc' }, take: 200_000 }),
    );
  }
}
