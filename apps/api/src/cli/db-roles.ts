/**
 * Ensures the restricted runtime role `app_rw` exists, for hosts where the database comes with a single
 * owner user (managed platforms) rather than the roles in packages/database/sql/bootstrap-roles.sql.
 * Run before `prisma migrate deploy`; it is idempotent.
 *
 *   DATABASE_MIGRATOR_URL=… APP_DB_PASSWORD=… node apps/api/dist/cli/db-roles.js
 *
 * Without APP_DB_PASSWORD the role is created NOLOGIN (enough for migrations to grant to it). With it, the
 * role can sign in with that password — then point DATABASE_URL at app_rw. The password is never printed.
 */
import { loadEnv, z } from '@smart-hr/config';
import { ensureRuntimeRole } from '@smart-hr/database';

const env = loadEnv(
  z.object({
    DATABASE_MIGRATOR_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    APP_DB_PASSWORD: z.string().min(16, 'Use at least 16 characters').optional(),
  }),
);
const result = await ensureRuntimeRole(env.DATABASE_MIGRATOR_URL, env.APP_DB_PASSWORD);
process.stdout.write(
  `Runtime role app_rw ${result.created ? 'created' : 'up to date'}${result.login ? ' (can sign in)' : ' (no sign-in)'}.\n`,
);
