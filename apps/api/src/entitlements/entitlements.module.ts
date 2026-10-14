import { Global, Module } from '@nestjs/common';
import { EntitlementsController } from './entitlements.controller.js';
import { EntitlementsService } from './entitlements.service.js';

/** Global so the auth guard and every module can check plan features and limits. */
@Global()
@Module({
  controllers: [EntitlementsController],
  providers: [EntitlementsService],
  exports: [EntitlementsService],
})
export class EntitlementsModule {}
