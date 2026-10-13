import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { WorkerEnv } from '../config/env.js';
import { SYSTEM_QUEUE, SystemJob, WORKER_ENV } from '../queues.js';

/** Registers the repeating heartbeat. Upserting is idempotent, so many worker tasks can start at once. */
@Injectable()
export class HeartbeatScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(SYSTEM_QUEUE) private readonly queue: Queue,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SystemJob.Heartbeat,
      { every: this.env.HEARTBEAT_INTERVAL_MS },
      { name: SystemJob.Heartbeat, opts: { removeOnComplete: 10, removeOnFail: 100 } },
    );
  }
}
