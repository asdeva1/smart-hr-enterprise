/**
 * Boots the worker against real Redis with an isolated queue prefix and waits for a heartbeat.
 * Requires REDIS_URL.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heartbeatKey, loadWorkerEnv } from '../src/config/env.js';
import { WorkerModule } from '../src/worker.module.js';

const prefix = `test-${randomUUID().slice(0, 8)}`;
let app: INestApplicationContext;
let redis: Redis;

beforeAll(async () => {
  const env = loadWorkerEnv({
    ...process.env,
    NODE_ENV: 'test',
    QUEUE_PREFIX: prefix,
    HEARTBEAT_INTERVAL_MS: '1000',
    EMAIL_SWEEP_INTERVAL_MS: '0',
    APPROVAL_ESCALATION_INTERVAL_MS: '0',
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://unused@localhost/unused',
  });
  redis = new Redis(env.REDIS_URL);
  app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env), { logger: false });
  app.enableShutdownHooks();
});

afterAll(async () => {
  await app?.close();
  const keys = await redis.keys(`${prefix}:*`);
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
});

describe('worker heartbeat', () => {
  it('processes the scheduled heartbeat and records when it ran', async () => {
    const started = Date.now();
    let last = 0;
    for (let i = 0; i < 40 && last < started; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      last = Number(await redis.get(heartbeatKey(prefix)));
    }
    expect(last).toBeGreaterThanOrEqual(started);
  });

  it('registers exactly one heartbeat schedule, however many times it boots', async () => {
    const second = await NestFactory.createApplicationContext(
      WorkerModule.forRoot(
        loadWorkerEnv({
          ...process.env,
          QUEUE_PREFIX: prefix,
          HEARTBEAT_INTERVAL_MS: '1000',
          EMAIL_SWEEP_INTERVAL_MS: '0',
          APPROVAL_ESCALATION_INTERVAL_MS: '0',
          DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://unused@localhost/unused',
        }),
      ),
      { logger: false },
    );
    await second.close();
    const schedulers = await redis.zcard(`${prefix}:system:repeat`);
    expect(schedulers).toBe(1);
  });
});
