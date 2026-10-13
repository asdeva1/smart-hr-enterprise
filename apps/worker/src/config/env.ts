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
  /** Base address of the web app, for links in emails. */
  APP_PUBLIC_URL: z.url().default('http://localhost:3000'),
  /** How often to deliver emails from the notification outbox. 0 turns the sweep off. */
  EMAIL_SWEEP_INTERVAL_MS: z.coerce.number().int().min(0).default(15_000),
  /** After this many failed attempts an outbox email is marked FAILED. */
  EMAIL_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  /** How often to look for overdue approval tasks. 0 turns the sweep off. */
  APPROVAL_ESCALATION_INTERVAL_MS: z.coerce.number().int().min(0).default(300_000),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return loadEnv(workerEnvSchema, source);
}

/** Redis key holding the epoch-millisecond time of the last processed heartbeat. */
export function heartbeatKey(prefix: string): string {
  return `${prefix}:worker:heartbeat`;
}
