/**
 * Creates any plan from the starting catalogue (@smart-hr/entitlements) that does not exist yet, with a
 * published version 1 and no prices. Never changes a plan that exists — operators own the catalogue.
 * Run after `prisma migrate deploy` on every deployment; it is idempotent.
 *
 *   DATABASE_MIGRATOR_URL=… node apps/api/dist/cli/sync-plan-catalogue.js
 */
import { loadEnv, z } from '@smart-hr/config';
import { createDatabaseClient } from '@smart-hr/database';
import { syncPlanCatalogue } from '../entitlements/catalogue-sync.js';

const env = loadEnv(z.object({ DATABASE_MIGRATOR_URL: z.url({ protocol: /^postgres(ql)?$/ }) }));
const db = createDatabaseClient({ connectionString: env.DATABASE_MIGRATOR_URL, maxConnections: 1 });
try {
  const { created } = await db.$transaction((tx) => syncPlanCatalogue(tx));
  process.stdout.write(
    created.length > 0 ? `Created plans: ${created.join(', ')}.\n` : 'Plan catalogue already up to date.\n',
  );
} finally {
  await db.$disconnect();
}
