import { Module } from '@nestjs/common';
import { LeaveModule } from '../leave/leave.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { AiFeaturesService } from './ai-features.service.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';

@Module({
  imports: [LeaveModule, OperationsModule, ProjectsModule],
  controllers: [AiController],
  providers: [AiService, AiFeaturesService],
})
export class AiModule {}
