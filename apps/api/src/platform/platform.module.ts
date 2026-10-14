import { Module } from '@nestjs/common';
import {
  PlatformPlansController,
  PlatformSubscriptionsController,
  PlatformTenantsController,
} from './platform.controller.js';
import { PlatformLicenceController } from './licence.controller.js';
import { PlansService } from './plans.service.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { PlatformTenantsService } from './tenants.service.js';

/** The platform console: catalogue and organisations. Every route requires a platform administrator. */
@Module({
  controllers: [
    PlatformPlansController,
    PlatformSubscriptionsController,
    PlatformTenantsController,
    PlatformLicenceController,
  ],
  providers: [PlansService, SubscriptionsService, PlatformTenantsService],
})
export class PlatformModule {}
