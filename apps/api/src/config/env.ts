import { baseServerEnvSchema, commaList, loadEnv, z } from '@smart-hr/config';

export const apiEnvSchema = baseServerEnvSchema.extend({
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  CORS_ORIGINS: commaList,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function loadApiEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return loadEnv(apiEnvSchema, source);
}
