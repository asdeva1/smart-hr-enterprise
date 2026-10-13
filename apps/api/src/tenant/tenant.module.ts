import { Module } from '@nestjs/common';
import { TenantSettingsController } from './tenant-settings.controller.js';

@Module({ controllers: [TenantSettingsController] })
export class TenantModule {}
