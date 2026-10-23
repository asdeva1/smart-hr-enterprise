import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { AssetsModule } from '../assets/assets.module.js';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { LeaveModule } from '../leave/leave.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { OverviewService } from './overview.service.js';
import { SelfServiceController } from './selfservice.controller.js';
import { SelfServiceService } from './selfservice.service.js';

@Module({
  imports: [AttendanceModule, LeaveModule, ApprovalsModule, OperationsModule, ProjectsModule, AssetsModule],
  controllers: [SelfServiceController],
  providers: [SelfServiceService, OverviewService],
})
export class SelfServiceModule {}
