/**
 * The Neon integration provides the owner's URLs. Keep the unpooled one for migrations and startup tasks, and
 * point the runtime at the same pooled host as the restricted `app_rw` role (created at build time).
 */
export function useRestrictedDatabaseRole(): void {
  const unpooled = process.env.DATABASE_URL_UNPOOLED;
  const password = process.env.APP_DB_PASSWORD;
  const pooled = process.env.DATABASE_URL;
  if (!unpooled || !password || !pooled) return;
  process.env.DATABASE_MIGRATOR_URL ??= unpooled;
  const url = new URL(pooled);
  url.username = 'app_rw';
  url.password = password;
  process.env.DATABASE_URL = url.toString();
}
