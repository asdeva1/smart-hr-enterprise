import 'reflect-metadata';
import { assertRestrictedRuntimeRole } from '@smart-hr/database';
import { createApp } from './app.factory.js';
import { loadApiEnv } from './config/env.js';

const env = loadApiEnv();
// Tenant isolation relies on row-level security, which the table owner and superusers bypass.
await assertRestrictedRuntimeRole(env.DATABASE_URL);
const app = await createApp(env);
await app.listen(env.API_PORT, '0.0.0.0');
