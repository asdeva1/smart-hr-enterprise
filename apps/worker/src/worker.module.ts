import { BullModule } from '@nestjs/bullmq';
import {
  Global,
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type Provider,
} from '@nestjs/common';
import { createDatabaseClient, type DatabaseClient } from '@smart-hr/database';
import { Redis } from 'ioredis';
import { createTransport, type Transporter } from 'nodemailer';
import type { WorkerEnv } from './config/env.js';
import { NotificationsProcessor } from './notifications/notifications.processor.js';
import { EscalationService } from './notifications/escalation.service.js';
import { OutboxService } from './notifications/outbox.service.js';
import { SubscriptionExpiryService } from './notifications/subscription-expiry.service.js';
import { SweepScheduler } from './notifications/sweep.scheduler.js';
import { DocumentSweepService } from './notifications/document-sweep.service.js';
import { DATABASE, MAIL_TRANSPORT, NOTIFICATIONS_QUEUE, REDIS, SYSTEM_QUEUE, WORKER_ENV } from './queues.js';
import { HeartbeatScheduler } from './system/heartbeat.scheduler.js';
import { SystemProcessor } from './system/system.processor.js';

export interface WorkerModuleOptions {
  /** Replaces the SMTP transport; used by tests to capture outgoing mail. */
  mailTransport?: Transporter | null;
}

@Global()
@Module({})
export class WorkerModule implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DATABASE) private readonly db: DatabaseClient,
  ) {}

  static forRoot(env: WorkerEnv, options: WorkerModuleOptions = {}): DynamicModule {
    const mailTransport: Provider =
      options.mailTransport !== undefined
        ? { provide: MAIL_TRANSPORT, useValue: options.mailTransport }
        : {
            provide: MAIL_TRANSPORT,
            useFactory: () => (env.SMTP_URL ? createTransport(env.SMTP_URL) : null),
          };

    return {
      module: WorkerModule,
      imports: [
        BullModule.forRoot({
          prefix: env.QUEUE_PREFIX,
          // BullMQ workers block on Redis, so they must never give up on a command.
          connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
          defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
        }),
        BullModule.registerQueue({ name: SYSTEM_QUEUE }, { name: NOTIFICATIONS_QUEUE }),
      ],
      providers: [
        { provide: WORKER_ENV, useValue: env },
        { provide: REDIS, useFactory: () => new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 }) },
        {
          provide: DATABASE,
          // Connects lazily, on the first query.
          useFactory: () => createDatabaseClient({ connectionString: env.DATABASE_URL, maxConnections: 5 }),
        },
        mailTransport,
        OutboxService,
        EscalationService,
        SubscriptionExpiryService,
        DocumentSweepService,
        SweepScheduler,
        SystemProcessor,
        HeartbeatScheduler,
        NotificationsProcessor,
      ],
      exports: [WORKER_ENV, REDIS, DATABASE],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
    await this.db.$disconnect();
  }
}
