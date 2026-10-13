import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { NotificationJob } from '@smart-hr/shared';
import { Queue } from 'bullmq';
import type { WorkerEnv } from '../config/env.js';
import { NOTIFICATIONS_QUEUE, WORKER_ENV } from '../queues.js';

/** Registers the repeating outbox and escalation sweeps (idempotent upserts; 0 = off and removed). */
@Injectable()
export class SweepScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.schedule(NotificationJob.OutboxSweep, this.env.EMAIL_SWEEP_INTERVAL_MS);
    await this.schedule(NotificationJob.EscalationSweep, this.env.APPROVAL_ESCALATION_INTERVAL_MS);
  }

  private async schedule(name: string, every: number): Promise<void> {
    if (every === 0) {
      await this.queue.removeJobScheduler(name);
      return;
    }
    await this.queue.upsertJobScheduler(
      name,
      { every },
      // A sweep is retried by the next run, so failures aren't retried with backoff.
      { name, opts: { attempts: 1, removeOnComplete: 10, removeOnFail: 100 } },
    );
  }
}
