/**
 * Creates or updates the built-in roles of every organisation from the catalogue in @smart-hr/shared.
 * Run after `prisma migrate deploy` on every deployment; it is idempotent.
 *
 *   DATABASE_MIGRATOR_URL=… node apps/api/dist/cli/sync-system-roles.js
 *
 * Uses the migrator role because it touches every tenant, which the runtime role cannot.
 */
import { loadEnv, z } from '@smart-hr/config';
import { createDatabaseClient } from '@smart-hr/database';
import { RbacService } from '../rbac/rbac.service.js';

const env = loadEnv(z.object({ DATABASE_MIGRATOR_URL: z.url({ protocol: /^postgres(ql)?$/ }) }));
const db = createDatabaseClient({ connectionString: env.DATABASE_MIGRATOR_URL, maxConnections: 1 });
const rbac = new RbacService();
try {
  const tenants = await db.tenant.findMany({ select: { id: true, slug: true } });
  for (const tenant of tenants) {
    await db.$transaction((tx) => rbac.ensureSystemRoles(tx, tenant.id));
  }
  process.stdout.write(`System roles up to date for ${tenants.length} organisation(s).\n`);
} finally {
  await db.$disconnect();
}
