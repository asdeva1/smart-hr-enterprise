import { defineConfig } from 'prisma/config';

/**
 * Migrations run as the schema-owning `app_migrator` role, never as the runtime `app_rw` role.
 * The shadow database is only needed by `migrate dev` and the CI drift check.
 */
const url = process.env.DATABASE_MIGRATOR_URL;
const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  ...(url ? { datasource: { url, ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}) } } : {}),
});
