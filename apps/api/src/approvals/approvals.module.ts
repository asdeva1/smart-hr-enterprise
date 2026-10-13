import { Global, Module } from '@nestjs/common';
import { ApprovalSubjectRegistry } from './approval-subjects.js';
import { ApprovalEngine } from './approval.engine.js';
import { ApprovalsController } from './approvals.controller.js';
import { ApprovalsService } from './approvals.service.js';

/** Global so any module can submit to the engine and register its subject handler. */
@Global()
@Module({
  controllers: [ApprovalsController],
  providers: [ApprovalEngine, ApprovalSubjectRegistry, ApprovalsService],
  exports: [ApprovalEngine, ApprovalSubjectRegistry],
})
export class ApprovalsModule {}
