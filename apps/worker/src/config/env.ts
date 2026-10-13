import { baseServerEnvSchema, loadEnv, z } from '@smart-hr/config';

export const workerEnvSchema = baseServerEnvSchema.extend({
  /** Namespaces every queue key in Redis, so environments can share a cluster safely. */
  QUEUE_PREFIX: z
    .string()
    .regex(/^[a-z0-9:_-]+$/)
    .default('smarthr'),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1_000).default(60_000),
  /** smtp://user:pass@host:port or smtps://…. Unset = email delivery disabled (jobs are recorded, not sent). */
  SMTP_URL: z.url({ protocol: /^smtps?$/ }).optional(),
  MAIL_FROM: z.string().min(3).default('Smart HR <no-reply@localhost>'),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return loadEnv(workerEnvSchema, source);
}

/** Redis key holding the epoch-millisecond time of the last processed heartbeat. */
export function heartbeatKey(prefix: string): string {
  return `${prefix}:worker:heartbeat`;
}
