import { BullModule } from '@nestjs/bullmq';
import { Global, Inject, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { WorkerEnv } from './config/env.js';
import { REDIS, SYSTEM_QUEUE, WORKER_ENV } from './queues.js';
import { HeartbeatScheduler } from './system/heartbeat.scheduler.js';
import { SystemProcessor } from './system/system.processor.js';

@Global()
@Module({})
export class WorkerModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  static forRoot(env: WorkerEnv): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        BullModule.forRoot({
          prefix: env.QUEUE_PREFIX,
          // BullMQ workers block on Redis, so they must never give up on a command.
          connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
          defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
        }),
        BullModule.registerQueue({ name: SYSTEM_QUEUE }),
      ],
      providers: [
        { provide: WORKER_ENV, useValue: env },
        { provide: REDIS, useFactory: () => new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 }) },
        SystemProcessor,
        HeartbeatScheduler,
      ],
      exports: [WORKER_ENV, REDIS],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
