import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import type { DatabaseClient } from '@smart-hr/database';
import { loadWorkerEnv } from './config/env.js';
import { CronModule } from './cron.module.js';
import { DocumentSweepService } from './notifications/document-sweep.service.js';
import { EscalationService } from './notifications/escalation.service.js';
import { OutboxService } from './notifications/outbox.service.js';
import { SubscriptionExpiryService } from './notifications/subscription-expiry.service.js';
import { DATABASE } from './queues.js';

/** The sweeps a scheduler can run, in the order a full run does them. */
export const CRON_JOBS = ['outbox', 'escalation', 'subscriptions', 'documents'] as const;
export type CronJob = (typeof CRON_JOBS)[number];

export function isCronJob(value: string): value is CronJob {
  return (CRON_JOBS as readonly string[]).includes(value);
}

export interface CronRun {
  job: CronJob;
  ok: boolean;
  result?: unknown;
  error?: string;
}

let context: Promise<INestApplicationContext> | undefined;

function boot(): Promise<INestApplicationContext> {
  const env = loadWorkerEnv();
  return NestFactory.createApplicationContext(CronModule.forRoot(env), { logger: ['error', 'warn'] });
}

/**
 * Runs the named sweeps once and reports each outcome. One failing sweep does not stop the others, and a
 * second run overlapping the first skips its turn inside the sweep (they take a database advisory lock).
 */
export async function runCronJobs(jobs: readonly CronJob[] = CRON_JOBS): Promise<CronRun[]> {
  context ??= boot().catch((error: unknown) => {
    context = undefined;
    throw error;
  });
  const app = await context;
  const runs: CronRun[] = [];
  for (const job of jobs) {
    try {
      const result = await run(app, job);
      runs.push({ job, ok: true, result });
    } catch (error) {
      runs.push({ job, ok: false, error: error instanceof Error ? error.message.slice(0, 300) : 'failed' });
    }
  }
  return runs;
}

function run(app: INestApplicationContext, job: CronJob): Promise<unknown> {
  switch (job) {
    case 'outbox':
      return app.get(OutboxService).sweep();
    case 'escalation':
      return app.get(EscalationService).sweep();
    case 'subscriptions':
      return app.get(SubscriptionExpiryService).sweep();
    case 'documents':
      return app.get(DocumentSweepService).sweep();
  }
}

/** For tests and shutdown hooks. */
export async function closeCron(): Promise<void> {
  const pending = context;
  context = undefined;
  if (pending) {
    const app = await pending;
    await app.get<DatabaseClient>(DATABASE).$disconnect();
    await app.close();
  }
}
