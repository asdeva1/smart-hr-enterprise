import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Redis } from 'ioredis';
import { heartbeatKey, type WorkerEnv } from '../config/env.js';
import { REDIS, SYSTEM_QUEUE, SystemJob, WORKER_ENV } from '../queues.js';

@Processor(SYSTEM_QUEUE)
export class SystemProcessor extends WorkerHost {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
  ) {
    super();
  }

  async process(job: Job): Promise<{ at: number }> {
    switch (job.name) {
      case SystemJob.Heartbeat: {
        const at = Date.now();
        await this.redis.set(heartbeatKey(this.env.QUEUE_PREFIX), String(at));
        return { at };
      }
      default:
        // Unknown jobs fail loudly so they show up in the failed-jobs dashboard instead of vanishing.
        throw new Error(`Unknown system job: ${job.name}`);
    }
  }
}
