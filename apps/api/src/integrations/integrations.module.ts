import { Global, Module } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard.js';
import { ApiKeysService } from './api-keys.service.js';
import { IntegrationsController } from './integrations.controller.js';
import { PublicApiController } from './public-api.controller.js';
import { PublicApiService } from './public-api.service.js';
import { WebhookEventsService } from './webhook-events.service.js';
import { WebhooksService } from './webhooks.service.js';

/** Global so any module can queue an event with WebhookEventsService without importing this one. */
@Global()
@Module({
  controllers: [IntegrationsController, PublicApiController],
  providers: [ApiKeysService, ApiKeyGuard, PublicApiService, WebhooksService, WebhookEventsService],
  exports: [WebhookEventsService],
})
export class IntegrationsModule {}
