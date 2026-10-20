/**
 * One-off setup the API can do for itself when it starts, for hosts with no shell to run the commands in
 * (managed platforms). Off unless STARTUP_TASKS=true. Uses the migrator (owner) connection, which is why it
 * is opt-in, and never prints a password.
 *
 *  - Brings the plan catalogue and every organisation's built-in roles up to date (idempotent), which a
 *    release that adds permissions or plan features needs.
 *  - First run: if the database has no organisation yet and BOOTSTRAP_TENANT_NAME, BOOTSTRAP_ADMIN_EMAIL,
 *    BOOTSTRAP_ADMIN_NAME and BOOTSTRAP_ADMIN_PASSWORD are set, creates the organisation and its owner
 *    account. Once an organisation exists it does nothing more, so the four settings can be deleted.
 *
 * A failure is reported and the API still starts, so a typo here never takes the app down.
 */
import { loadEnv, z } from '@smart-hr/config';
import { createDatabaseClient, type DatabaseClient } from '@smart-hr/database';
import { BootstrapError, bootstrapTenant } from './cli/bootstrap-core.js';
import { syncPlanCatalogue } from './entitlements/catalogue-sync.js';
import { RbacService } from './rbac/rbac.service.js';

const startupSchema = z.object({
  STARTUP_TASKS: z.stringbool().default(false),
  DATABASE_MIGRATOR_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  BOOTSTRAP_TENANT_NAME: z.string().trim().min(2).max(200).optional(),
  BOOTSTRAP_TENANT_SLUG: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/)
    .optional(),
  BOOTSTRAP_ADMIN_EMAIL: z.email().optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().trim().min(1).max(200).optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(1).optional(),
});

export type StartupTaskResult = { ran: boolean; created?: string; messages: string[] };

/** A URL-safe organisation key from its name, e.g. "Acme Health Pvt. Ltd." -> "acme-health-pvt-ltd". */
export function slugFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  return slug.length >= 2 ? slug : 'organisation';
}

export async function runStartupTasks(
  source: NodeJS.ProcessEnv = process.env,
  options: { db?: DatabaseClient } = {},
): Promise<StartupTaskResult> {
  const messages: string[] = [];
  let env: z.output<typeof startupSchema>;
  try {
    env = loadEnv(startupSchema, source);
  } catch (error) {
    messages.push(`Startup tasks skipped: ${error instanceof Error ? error.message : 'invalid settings'}`);
    return { ran: false, messages };
  }
  if (!env.STARTUP_TASKS) return { ran: false, messages };
  if (!env.DATABASE_MIGRATOR_URL) {
    return { ran: false, messages: ['STARTUP_TASKS is on but DATABASE_MIGRATOR_URL is not set; skipped.'] };
  }
  const db =
    options.db ?? createDatabaseClient({ connectionString: env.DATABASE_MIGRATOR_URL, maxConnections: 1 });
  try {
    await syncPlanCatalogue(db);
    const rbac = new RbacService();
    const tenants = await db.tenant.findMany({ select: { id: true } });
    for (const tenant of tenants) await db.$transaction((tx) => rbac.ensureSystemRoles(tx, tenant.id));
    messages.push(`Plans and built-in roles up to date for ${tenants.length} organisation(s).`);

    const wanted = [
      env.BOOTSTRAP_TENANT_NAME,
      env.BOOTSTRAP_ADMIN_EMAIL,
      env.BOOTSTRAP_ADMIN_NAME,
      env.BOOTSTRAP_ADMIN_PASSWORD,
    ];
    if (tenants.length === 0 && wanted.every(Boolean)) {
      const result = await bootstrapTenant(db, {
        slug: env.BOOTSTRAP_TENANT_SLUG ?? slugFromName(env.BOOTSTRAP_TENANT_NAME!),
        name: env.BOOTSTRAP_TENANT_NAME!,
        adminEmail: env.BOOTSTRAP_ADMIN_EMAIL!,
        adminName: env.BOOTSTRAP_ADMIN_NAME!,
        adminPassword: env.BOOTSTRAP_ADMIN_PASSWORD!,
      });
      messages.push(
        `First-run setup: created organisation "${result.tenant.name}" with owner ${result.email}. ` +
          'You can now delete the BOOTSTRAP_* settings.',
      );
      return { ran: true, created: result.tenant.slug, messages };
    }
    if (tenants.length === 0) {
      messages.push('No organisation yet. Set the four BOOTSTRAP_* settings to create the first one.');
    }
    return { ran: true, messages };
  } catch (error) {
    messages.push(
      error instanceof BootstrapError
        ? error.message
        : `Startup tasks failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
    return { ran: false, messages };
  } finally {
    if (!options.db) await db.$disconnect();
  }
}
