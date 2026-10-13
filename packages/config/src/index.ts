import { z } from 'zod';

export { z };

export const deploymentModes = ['saas', 'dedicated', 'inhouse'] as const;
export type DeploymentMode = (typeof deploymentModes)[number];

/** Fields every server-side process (api, worker) needs. */
export const baseServerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DEPLOYMENT_MODE: z.enum(deploymentModes).default('saas'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
});

export type BaseServerEnv = z.infer<typeof baseServerEnvSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Validates the given environment against a schema and fails fast with every problem listed.
 * Values are never echoed in the error, so secrets cannot leak into logs.
 */
export function loadEnv<S extends z.ZodType>(schema: S, source: NodeJS.ProcessEnv = process.env): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(root)';
      return `${key}: ${issue.message}`;
    });
    throw new EnvValidationError(issues);
  }
  return result.data;
}

/** Parses a comma-separated env value into a trimmed, non-empty list. */
export const commaList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );
