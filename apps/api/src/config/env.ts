import { baseServerEnvSchema, commaList, loadEnv, z } from '@smart-hr/config';

const minutes = (fallback: number) => z.coerce.number().int().min(1).max(10_080).default(fallback);

export const apiEnvSchema = baseServerEnvSchema
  .extend({
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    CORS_ORIGINS: commaList,
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    /** Must match the worker's prefix so jobs reach it. */
    QUEUE_PREFIX: z
      .string()
      .regex(/^[a-z0-9:_-]+$/)
      .default('smarthr'),
    /** Public URL of the web app, used in emailed links. */
    APP_PUBLIC_URL: z.url().default('http://localhost:3000'),

    // Sessions
    AUTH_SESSION_IDLE_MINUTES: minutes(30),
    AUTH_SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(168).default(12),
    AUTH_REAUTH_MINUTES: minutes(10),
    /** Cookie domain, e.g. `.example.com` when web and API are on sibling subdomains. Unset = host-only. */
    AUTH_COOKIE_DOMAIN: z.string().optional(),
    /** Defaults to true in production. Only local HTTP development may turn it off. */
    AUTH_COOKIE_SECURE: z.stringbool().optional(),

    // Brute-force protection
    AUTH_LOCKOUT_THRESHOLD: z.coerce.number().int().min(3).max(50).default(5),
    AUTH_LOCKOUT_MINUTES: minutes(15),
    AUTH_RATE_LIMIT_LOGIN_PER_IP: z.coerce.number().int().min(1).default(30),
    AUTH_RATE_LIMIT_LOGIN_PER_EMAIL: z.coerce.number().int().min(1).default(10),
    AUTH_RATE_LIMIT_RESET_PER_EMAIL: z.coerce.number().int().min(1).default(3),
    AUTH_RATE_LIMIT_RESET_PER_IP: z.coerce.number().int().min(1).default(20),

    // Password reset and invitations
    PASSWORD_RESET_TTL_MINUTES: minutes(30),
    INVITATION_TTL_HOURS: z.coerce.number().int().min(1).max(336).default(72),

    // Self-service sign-up (off unless enabled; dedicated and in-house installations leave it off)
    SIGNUP_ENABLED: z.stringbool().default(false),
    /** Plan a new self-service organisation starts on, as a trial. */
    SIGNUP_PLAN: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{1,29}$/)
      .default('PRO'),
    SIGNUP_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    SIGNUP_RATE_LIMIT_PER_IP: z.coerce.number().int().min(1).default(10),
    SIGNUP_RATE_LIMIT_PER_EMAIL: z.coerce.number().int().min(1).default(3),

    // MFA
    MFA_ISSUER: z.string().min(1).max(64).default('Smart HR'),
    /** Comma-separated `id:base64key` pairs (32-byte keys). Older keys stay listed to decrypt existing secrets. */
    MFA_ENCRYPTION_KEYS: z
      .string()
      .min(1)
      .transform((value, ctx) => {
        const keys: Record<string, string> = {};
        for (const pair of value.split(',')) {
          const [id, key] = pair.split(':').map((s) => s.trim());
          if (!id || !key) {
            ctx.addIssue({ code: 'custom', message: 'Use the format id:base64key,id2:base64key' });
            return z.NEVER;
          }
          keys[id] = key;
        }
        return keys;
      }),
    MFA_ENCRYPTION_KEY_ID: z.string().min(1),
  })
  .transform((env) => ({
    ...env,
    AUTH_COOKIE_SECURE: env.AUTH_COOKIE_SECURE ?? env.NODE_ENV === 'production',
  }))
  .superRefine((env, ctx) => {
    if (!(env.MFA_ENCRYPTION_KEY_ID in env.MFA_ENCRYPTION_KEYS)) {
      ctx.addIssue({
        code: 'custom',
        path: ['MFA_ENCRYPTION_KEY_ID'],
        message: 'must name one of MFA_ENCRYPTION_KEYS',
      });
    }
    if (env.NODE_ENV === 'production' && !env.AUTH_COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_COOKIE_SECURE'],
        message: 'cannot be false in production',
      });
    }
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function loadApiEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return loadEnv(apiEnvSchema, source);
}
