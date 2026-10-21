import { Module, type DynamicModule } from '@nestjs/common';
import { createDatabaseClient } from '@smart-hr/database';
import { createTransport } from 'nodemailer';
import type { WorkerEnv } from './config/env.js';
import { DocumentSweepService } from './notifications/document-sweep.service.js';
import { EscalationService } from './notifications/escalation.service.js';
import { MailQueueService } from './notifications/mail-queue.service.js';
import { OutboxService } from './notifications/outbox.service.js';
import { SubscriptionExpiryService } from './notifications/subscription-expiry.service.js';
import { WebhookDeliveryService } from './integrations/webhook-delivery.service.js';
import { DATABASE, MAIL_TRANSPORT, WORKER_ENV } from './queues.js';

/**
 * The sweeps without the queue: for hosts that cannot keep a worker running (serverless), where a scheduler
 * calls each sweep directly. It needs the database and mail settings, plus Redis only to read the queued emails.
 */
@Module({})
export class CronModule {
  static forRoot(env: WorkerEnv): DynamicModule {
    return {
      module: CronModule,
      providers: [
        { provide: WORKER_ENV, useValue: env },
        // A single connection: each invocation is short-lived and the pooler multiplexes across instances.
        {
          provide: DATABASE,
          useFactory: () => createDatabaseClient({ connectionString: env.DATABASE_URL, maxConnections: 1 }),
        },
        { provide: MAIL_TRANSPORT, useFactory: () => (env.SMTP_URL ? createTransport(env.SMTP_URL) : null) },
        OutboxService,
        MailQueueService,
        EscalationService,
        SubscriptionExpiryService,
        DocumentSweepService,
        WebhookDeliveryService,
      ],
    };
  }
}
