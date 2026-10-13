import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { OrgController } from './org.controller.js';
import { OrgService } from './org.service.js';

@Module({
  imports: [RbacModule],
  controllers: [OrgController],
  providers: [OrgService],
})
export class OrgModule {}
