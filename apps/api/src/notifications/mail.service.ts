import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { NotificationJob, QUEUES, type EmailJobData } from '@smart-hr/shared';
import { Queue } from 'bullmq';
import type { ApiEnv } from '../config/env.js';
import { API_ENV } from '../infra/tokens.js';

/**
 * Hands emails to the worker through the notifications queue. The API never talks to SMTP itself,
 * so a slow or failing mail server cannot hold up requests, and failed sends are retried.
 */
@Injectable()
export class MailService implements OnApplicationShutdown {
  private readonly queue: Queue<EmailJobData>;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.queue = new Queue<EmailJobData>(QUEUES.notifications, {
      prefix: env.QUEUE_PREFIX,
      connection: { url: env.REDIS_URL, maxRetriesPerRequest: 1, enableOfflineQueue: false },
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 10_000 },
        // Emails can contain one-time links: keep them in Redis only as long as needed.
        removeOnComplete: true,
        removeOnFail: { age: 24 * 3600 },
      },
    });
  }

  async send(email: EmailJobData): Promise<void> {
    await this.queue.add(NotificationJob.Email, email);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
