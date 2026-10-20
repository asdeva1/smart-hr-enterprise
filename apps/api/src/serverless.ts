import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { assertRestrictedRuntimeRole } from '@smart-hr/database';
import { createApp } from './app.factory.js';
import { loadApiEnv } from './config/env.js';
import { runStartupTasks } from './startup-tasks.js';

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

let ready: Promise<RequestHandler> | undefined;

/** Builds the application once per warm function instance. Startup tasks and the role guard run on a cold start. */
async function boot(): Promise<RequestHandler> {
  const env = loadApiEnv();
  await assertRestrictedRuntimeRole(env.DATABASE_URL);
  for (const message of (await runStartupTasks()).messages) process.stdout.write(`[startup] ${message}\n`);
  const app = await createApp(env);
  await app.init();
  return app.getHttpAdapter().getInstance() as RequestHandler;
}

/** Vercel function handler. A failed boot is not cached, so the next request tries again. */
export async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  ready ??= boot().catch((error: unknown) => {
    ready = undefined;
    throw error;
  });
  (await ready)(req, res);
}
