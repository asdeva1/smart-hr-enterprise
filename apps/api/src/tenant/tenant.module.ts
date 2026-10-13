import { Global, Module } from '@nestjs/common';
import { ConfigurationController } from './configuration.controller.js';
import { ConfigurationService } from './configuration.service.js';
import { TenantSettingsController } from './tenant-settings.controller.js';

/** Global so any module can read effective organisation settings. */
@Global()
@Module({
  controllers: [TenantSettingsController, ConfigurationController],
  providers: [ConfigurationService],
  exports: [ConfigurationService],
})
export class TenantModule {}
