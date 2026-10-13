import { Global, Module } from '@nestjs/common';
import { RbacService } from './rbac.service.js';

@Global()
@Module({
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}
