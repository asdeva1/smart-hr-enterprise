import { Global, Module } from '@nestjs/common';
import { BrandingController } from './branding.controller.js';
import { ConfigurationController } from './configuration.controller.js';
import { ConfigurationService } from './configuration.service.js';
import { TenantExportController } from './export.controller.js';
import { TenantExportService } from './export.service.js';
import { TenantSettingsController } from './tenant-settings.controller.js';

/** Global so any module can read effective organisation settings. */
@Global()
@Module({
  controllers: [
    TenantSettingsController,
    ConfigurationController,
    BrandingController,
    TenantExportController,
  ],
  providers: [ConfigurationService, TenantExportService],
  exports: [ConfigurationService, TenantExportService],
})
export class TenantModule {}
