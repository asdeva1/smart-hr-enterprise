import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { AccessController } from './access.controller.js';
import { AccessService } from './access.service.js';

@Module({
  imports: [RbacModule],
  controllers: [AccessController],
  providers: [AccessService],
})
export class AccessModule {}
