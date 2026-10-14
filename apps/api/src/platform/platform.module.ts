import { Module } from '@nestjs/common';
import { PlatformPlansController, PlatformSubscriptionsController } from './platform.controller.js';
import { PlansService } from './plans.service.js';
import { SubscriptionsService } from './subscriptions.service.js';

/** The platform console: catalogue and organisations. Every route requires a platform administrator. */
@Module({
  controllers: [PlatformPlansController, PlatformSubscriptionsController],
  providers: [PlansService, SubscriptionsService],
})
export class PlatformModule {}
