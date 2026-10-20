import 'reflect-metadata';
import { assertRestrictedRuntimeRole } from '@smart-hr/database';
import { createApp } from './app.factory.js';
import { loadApiEnv } from './config/env.js';
import { runStartupTasks } from './startup-tasks.js';

const env = loadApiEnv();
// Tenant isolation relies on row-level security, which the table owner and superusers bypass.
await assertRestrictedRuntimeRole(env.DATABASE_URL);
for (const message of (await runStartupTasks()).messages) process.stdout.write(`[startup] ${message}\n`);
const app = await createApp(env);
await app.listen(env.API_PORT, '0.0.0.0');
