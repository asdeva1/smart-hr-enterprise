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
  /** How often to record expired subscriptions. 0 turns the sweep off. */
  SUBSCRIPTION_SWEEP_INTERVAL_MS: z.coerce.number().int().min(0).default(3_600_000),
  /** How often to send document expiry reminders and close overdue signature requests. 0 turns it off. */
  DOCUMENT_SWEEP_INTERVAL_MS: z.coerce.number().int().min(0).default(3_600_000),
  /** Days before a document's expiry date that the reminder goes out. */
  DOCUMENT_REMINDER_DAYS: z.coerce.number().int().min(0).max(365).default(30),
  /** How often to send queued webhook events. 0 turns the sweep off. */
  WEBHOOK_SWEEP_INTERVAL_MS: z.coerce.number().int().min(0).default(15_000),
  /** Tries per event before it is marked FAILED (waits grow 1, 4, 16 … minutes between tries). */
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(12).default(6),
  /** An endpoint is switched off after this many events in a row that failed for good. */
  WEBHOOK_DISABLE_AFTER: z.coerce.number().int().min(1).max(1000).default(25),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
  /** Development and tests only: lets webhooks reach private addresses such as localhost. */
  WEBHOOK_ALLOW_PRIVATE_HOSTS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** The same key ring the API uses for personal data; needed to read webhook signing secrets. */
  DATA_ENCRYPTION_KEYS: z.string().min(1).optional(),
  DATA_ENCRYPTION_KEY_ID: z.string().min(1).optional(),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const env = loadEnv(workerEnvSchema, source);
  if (env.NODE_ENV === 'production' && env.WEBHOOK_ALLOW_PRIVATE_HOSTS) {
    throw new Error('WEBHOOK_ALLOW_PRIVATE_HOSTS must not be turned on in production');
  }
  return env;
}

/** Reads `id:base64key,id2:base64key` into the key ring the secret box expects. */
export function parseKeyRing(value: string): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const pair of value.split(',')) {
    const [id, key] = pair.split(':').map((s) => s.trim());
    if (!id || !key) throw new Error('DATA_ENCRYPTION_KEYS must look like id:base64key,id2:base64key');
    keys[id] = key;
  }
  return keys;
}

/** Redis key holding the epoch-millisecond time of the last processed heartbeat. */
export function heartbeatKey(prefix: string): string {
  return `${prefix}:worker:heartbeat`;
}
