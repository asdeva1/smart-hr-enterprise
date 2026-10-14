import { Global, Module } from '@nestjs/common';
import { EntitlementsController } from './entitlements.controller.js';
import { EntitlementsService } from './entitlements.service.js';
import { LicenceService } from './licence.service.js';

/** Global so the auth guard and every module can check plan features and limits. */
@Global()
@Module({
  controllers: [EntitlementsController],
  providers: [EntitlementsService, LicenceService],
  exports: [EntitlementsService, LicenceService],
})
export class EntitlementsModule {}
