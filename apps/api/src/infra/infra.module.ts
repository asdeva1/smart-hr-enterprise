import { Global, Inject, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabaseClient, type DatabaseClient } from '@smart-hr/database';
import { Redis } from 'ioredis';
import type { ApiEnv } from '../config/env.js';
import { API_ENV, DATABASE, REDIS } from './tokens.js';

/** Provides the validated environment and the shared database and Redis clients. */
@Global()
@Module({})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: InfraModule,
      providers: [
        { provide: API_ENV, useValue: env },
        {
          provide: DATABASE,
          useFactory: () =>
            createDatabaseClient({
              connectionString: env.DATABASE_URL,
              maxConnections: env.DATABASE_POOL_MAX,
            }),
        },
        {
          provide: REDIS,
          useFactory: () =>
            new Redis(env.REDIS_URL, {
              lazyConnect: true,
              // Serverless instances open a fresh TLS connection after idle; allow for a slow first handshake.
              connectTimeout: 15_000,
              maxRetriesPerRequest: 1,
              enableOfflineQueue: false,
            }),
        },
      ],
      exports: [API_ENV, DATABASE, REDIS],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.db.$disconnect(), this.redis.quit()]);
  }
}
