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
 */
import { checkPasswordPolicy, hashPassword, normalizeEmail, PASSWORD_PROBLEM_MESSAGES } from '@smart-hr/auth';
import { loadEnv, z } from '@smart-hr/config';
import { createDatabaseClient } from '@smart-hr/database';

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
  }),
);

const email = normalizeEmail(env.BOOTSTRAP_ADMIN_EMAIL);
const problems = checkPasswordPolicy(env.BOOTSTRAP_ADMIN_PASSWORD, { email });
if (problems.length > 0) {
  process.stderr.write(
    `Password rejected: ${problems.map((p) => PASSWORD_PROBLEM_MESSAGES[p]).join('; ')}\n`,
  );
  process.exit(1);
}

const db = createDatabaseClient({ connectionString: env.DATABASE_MIGRATOR_URL, maxConnections: 1 });
try {
  const tenant = await db.tenant.upsert({
    where: { slug: env.BOOTSTRAP_TENANT_SLUG },
    create: { slug: env.BOOTSTRAP_TENANT_SLUG, name: env.BOOTSTRAP_TENANT_NAME },
    update: {},
  });

  const existing = await db.user.findUnique({ where: { email } });
  const setPassword = !existing || env.BOOTSTRAP_RESET_PASSWORD;
  const passwordFields = setPassword
    ? { passwordHash: await hashPassword(env.BOOTSTRAP_ADMIN_PASSWORD), passwordChangedAt: new Date() }
    : {};
  const user = await db.user.upsert({
    where: { email },
    create: {
      email,
      displayName: env.BOOTSTRAP_ADMIN_NAME,
      isPlatformAdmin: env.BOOTSTRAP_PLATFORM_ADMIN,
      ...passwordFields,
    },
    update: {
      ...passwordFields,
      ...(env.BOOTSTRAP_PLATFORM_ADMIN ? { isPlatformAdmin: true } : {}),
      ...(setPassword ? { failedLoginCount: 0, lockedUntil: null } : {}),
    },
  });

  await db.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
    create: { tenantId: tenant.id, userId: user.id, isTenantAdmin: true },
    update: { isTenantAdmin: true, status: 'ACTIVE' },
  });

  await db.auditEvent.create({
    data: {
      action: 'platform.bootstrap',
      outcome: 'SUCCESS',
      tenantId: tenant.id,
      targetType: 'user',
      targetId: user.id,
      metadata: { tenantSlug: tenant.slug, createdUser: !existing, passwordSet: setPassword },
    },
  });

  process.stdout.write(
    `Organisation "${tenant.name}" (${tenant.slug}) ready; administrator ${email} ${existing ? 'updated' : 'created'}.\n`,
  );
} finally {
  await db.$disconnect();
}
