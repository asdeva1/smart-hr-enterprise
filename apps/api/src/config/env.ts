import { baseServerEnvSchema, commaList, loadEnv, z } from '@smart-hr/config';
import { parsePublicKeys, type PublicKeyRing } from '@smart-hr/licensing';

/** Comma-separated `id:base64key` pairs. Older keys stay listed so existing values can still be decrypted. */
const keyRing = z
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
  });

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

    // In-house licensing: public keys only (`keyId:base64 SPKI`, comma-separated). Never a private key.
    LICENCE_PUBLIC_KEYS: z
      .string()
      .optional()
      .transform((value, ctx): PublicKeyRing => {
        try {
          return parsePublicKeys(value);
        } catch (error) {
          ctx.addIssue({
            code: 'custom',
            message: error instanceof Error ? error.message : 'Invalid key list',
          });
          return z.NEVER;
        }
      }),

    // MFA
    MFA_ISSUER: z.string().min(1).max(64).default('Smart HR'),
    /** Comma-separated `id:base64key` pairs (32-byte keys). Older keys stay listed to decrypt existing secrets. */
    MFA_ENCRYPTION_KEYS: keyRing,
    MFA_ENCRYPTION_KEY_ID: z.string().min(1),

    // Personal data (identity numbers, bank details): a separate key ring from MFA, so each can be rotated
    // and protected on its own.
    DATA_ENCRYPTION_KEYS: keyRing,
    DATA_ENCRYPTION_KEY_ID: z.string().min(1),

    // AI (optional, server-side only). Without a key the AI features report that they are not available.
    ANTHROPIC_API_KEY: z.string().min(10).optional(),
    ANTHROPIC_BASE_URL: z.url().default('https://api.anthropic.com'),
    /** Which service answers. Left out, it is Bedrock when a Bedrock API key is set, else Anthropic when a key is set. IAM keys need AI_PROVIDER=bedrock. */
    AI_PROVIDER: z.enum(['anthropic', 'bedrock']).optional(),
    /** For Bedrock this must be a Bedrock model id or inference profile id from your AWS account. */
    AI_MODEL: z.string().min(1).max(200).optional(),
    // Claude on Amazon Bedrock, billed on the organisation's AWS invoice. Either a Bedrock API key, or IAM keys
    // (SigV4). Temporary credentials from a role also need AWS_SESSION_TOKEN.
    AWS_REGION: z.string().min(2).max(30).optional(),
    AWS_BEARER_TOKEN_BEDROCK: z.string().min(10).optional(),
    AWS_ACCESS_KEY_ID: z.string().min(10).optional(),
    AWS_SECRET_ACCESS_KEY: z.string().min(10).optional(),
    AWS_SESSION_TOKEN: z.string().min(10).optional(),
    BEDROCK_BASE_URL: z.url().optional(),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(8192).default(1024),

    // Document storage. Files are encrypted with DATA_ENCRYPTION_KEYS before they are written. `local` keeps
    // them on disk (development and in-house, on a mounted volume); object storage arrives with the AWS phase.
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    // Used when STORAGE_DRIVER=s3 (AWS S3 or an S3-compatible service). Set S3_ENDPOINT only for the latter.
    S3_BUCKET: z.string().min(3).max(63).optional(),
    S3_REGION: z.string().min(2).max(30).optional(),
    S3_ACCESS_KEY_ID: z.string().min(8).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(8).optional(),
    S3_SESSION_TOKEN: z.string().min(8).optional(),
    S3_ENDPOINT: z.url().optional(),
    STORAGE_LOCAL_DIR: z.string().min(1).default('.data/storage'),
    DOCUMENT_MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(50).default(10),
  })
  .transform((env) => ({
    ...env,
    AUTH_COOKIE_SECURE: env.AUTH_COOKIE_SECURE ?? env.NODE_ENV === 'production',
    AI_PROVIDER:
      env.AI_PROVIDER ??
      // IAM keys alone never switch it on: servers running on AWS often carry them for other reasons.
      (env.AWS_BEARER_TOKEN_BEDROCK
        ? ('bedrock' as const)
        : env.ANTHROPIC_API_KEY
          ? ('anthropic' as const)
          : undefined),
  }))
  .superRefine((env, ctx) => {
    if (!(env.MFA_ENCRYPTION_KEY_ID in env.MFA_ENCRYPTION_KEYS)) {
      ctx.addIssue({
        code: 'custom',
        path: ['MFA_ENCRYPTION_KEY_ID'],
        message: 'must name one of MFA_ENCRYPTION_KEYS',
      });
    }
    if (!(env.DATA_ENCRYPTION_KEY_ID in env.DATA_ENCRYPTION_KEYS)) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATA_ENCRYPTION_KEY_ID'],
        message: 'must name one of DATA_ENCRYPTION_KEYS',
      });
    }
    const mfaKeys = new Set(Object.values(env.MFA_ENCRYPTION_KEYS));
    if (Object.values(env.DATA_ENCRYPTION_KEYS).some((key) => mfaKeys.has(key))) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATA_ENCRYPTION_KEYS'],
        message: 'must not reuse a key from MFA_ENCRYPTION_KEYS',
      });
    }
    if (env.AI_PROVIDER === 'bedrock') {
      if (!env.AI_MODEL) {
        ctx.addIssue({
          code: 'custom',
          path: ['AI_MODEL'],
          message:
            'is required for Bedrock: use a Bedrock model id or inference profile id from your AWS account',
        });
      }
      if (!env.AWS_REGION && !env.BEDROCK_BASE_URL) {
        ctx.addIssue({ code: 'custom', path: ['AWS_REGION'], message: 'is required for Bedrock' });
      }
      if (!env.AWS_BEARER_TOKEN_BEDROCK && !(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY)) {
        ctx.addIssue({
          code: 'custom',
          path: ['AWS_BEARER_TOKEN_BEDROCK'],
          message: 'or AWS_ACCESS_KEY_ID with AWS_SECRET_ACCESS_KEY is required for Bedrock',
        });
      }
    }
    if (env.STORAGE_DRIVER === 's3') {
      for (const name of ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!env[name])
          ctx.addIssue({ code: 'custom', path: [name], message: 'is required for STORAGE_DRIVER=s3' });
      }
    }
    if (env.AI_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['ANTHROPIC_API_KEY'],
        message: 'is required for AI_PROVIDER=anthropic',
      });
    }
    if (env.DEPLOYMENT_MODE === 'inhouse') {
      if (env.LICENCE_PUBLIC_KEYS.size === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['LICENCE_PUBLIC_KEYS'],
          message: 'is required when DEPLOYMENT_MODE=inhouse',
        });
      }
      if (env.SIGNUP_ENABLED) {
        ctx.addIssue({
          code: 'custom',
          path: ['SIGNUP_ENABLED'],
          message: 'self-service sign-up is not available in-house',
        });
      }
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
