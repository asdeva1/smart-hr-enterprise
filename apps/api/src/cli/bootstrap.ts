/**
 * Creates (or updates) an organisation and its first administrator.
 *
 *   BOOTSTRAP_TENANT_SLUG=acme BOOTSTRAP_TENANT_NAME="Acme Health" \
 *   BOOTSTRAP_ADMIN_EMAIL=admin@acme.example BOOTSTRAP_ADMIN_NAME="Asha Rao" \
 *   BOOTSTRAP_ADMIN_PASSWORD='…' pnpm --filter @smart-hr/api bootstrap:tenant
 *
 * Runs with DATABASE_MIGRATOR_URL because creating a tenant is a platform operation that the runtime role
 * cannot perform (tenant self-service onboarding arrives in Phase 6). Idempotent: an existing user keeps
 * their password unless BOOTSTRAP_RESET_PASSWORD=true. The password is never printed.
 *
 * A new organisation is put on BOOTSTRAP_PLAN (default ENTERPRISE) as an open-ended active subscription,
 * typical for an in-house or dedicated installation. An organisation that already has a subscription keeps it.
 */
import { loadEnv, z } from '@smart-hr/config';
import { createDatabaseClient } from '@smart-hr/database';
import { BootstrapError, bootstrapTenant } from './bootstrap-core.js';

const env = loadEnv(
  z.object({
    DATABASE_MIGRATOR_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    BOOTSTRAP_TENANT_SLUG: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
    BOOTSTRAP_TENANT_NAME: z.string().min(2).max(200),
    BOOTSTRAP_ADMIN_EMAIL: z.email(),
    BOOTSTRAP_ADMIN_NAME: z.string().min(1).max(200),
    BOOTSTRAP_ADMIN_PASSWORD: z.string().min(1),
    BOOTSTRAP_PLATFORM_ADMIN: z.stringbool().default(false),
    BOOTSTRAP_RESET_PASSWORD: z.stringbool().default(false),
    BOOTSTRAP_PLAN: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{1,29}$/)
      .default('ENTERPRISE'),
  }),
);

const db = createDatabaseClient({ connectionString: env.DATABASE_MIGRATOR_URL, maxConnections: 1 });
try {
  const result = await bootstrapTenant(db, {
    slug: env.BOOTSTRAP_TENANT_SLUG,
    name: env.BOOTSTRAP_TENANT_NAME,
    adminEmail: env.BOOTSTRAP_ADMIN_EMAIL,
    adminName: env.BOOTSTRAP_ADMIN_NAME,
    adminPassword: env.BOOTSTRAP_ADMIN_PASSWORD,
    platformAdmin: env.BOOTSTRAP_PLATFORM_ADMIN,
    resetPassword: env.BOOTSTRAP_RESET_PASSWORD,
    plan: env.BOOTSTRAP_PLAN,
  });
  process.stdout.write(
    `Organisation "${result.tenant.name}" (${result.tenant.slug}) ready; administrator ${result.email} ${result.createdUser ? 'created' : 'updated'}.\n`,
  );
} catch (error) {
  if (error instanceof BootstrapError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
} finally {
  await db.$disconnect();
}
