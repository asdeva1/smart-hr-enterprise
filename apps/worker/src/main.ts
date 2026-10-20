import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { assertRestrictedRuntimeRole } from '@smart-hr/database';
import { createLogger } from '@smart-hr/observability';
import { loadWorkerEnv } from './config/env.js';
import { PinoNestLogger } from './logger.js';
import { WorkerModule } from './worker.module.js';

const env = loadWorkerEnv();
// Tenant isolation relies on row-level security, which the table owner and superusers bypass.
await assertRestrictedRuntimeRole(env.DATABASE_URL);
const logger = createLogger({
  service: 'worker',
  level: env.LOG_LEVEL,
  base: { deploymentMode: env.DEPLOYMENT_MODE },
});

const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env), {
  logger: new PinoNestLogger(logger),
});
app.enableShutdownHooks();
logger.info({ queuePrefix: env.QUEUE_PREFIX }, 'worker started');
