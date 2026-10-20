/**
 * Creates (or updates) an organisation and its first administrator. Shared by the `bootstrap` command and
 * the API's first-run setup. Needs the migrator (owner) connection: creating a tenant is a platform
 * operation the runtime role cannot perform. Idempotent: an existing user keeps their password unless
 * `resetPassword` is set. The password is never returned or printed.
 */
import { checkPasswordPolicy, hashPassword, normalizeEmail, PASSWORD_PROBLEM_MESSAGES } from '@smart-hr/auth';
import type { DatabaseClient } from '@smart-hr/database';
import { latestPublishedVersion, syncPlanCatalogue } from '../entitlements/catalogue-sync.js';
import { RbacService } from '../rbac/rbac.service.js';

export interface BootstrapInput {
  slug: string;
  name: string;
  adminEmail: string;
  adminName: string;
  adminPassword: string;
  platformAdmin?: boolean;
  resetPassword?: boolean;
  /** Plan for a new organisation with no subscription. */
  plan?: string;
}

export class BootstrapError extends Error {}

export async function bootstrapTenant(db: DatabaseClient, input: BootstrapInput) {
  const email = normalizeEmail(input.adminEmail);
  const problems = checkPasswordPolicy(input.adminPassword, { email });
  if (problems.length > 0) {
    throw new BootstrapError(
      `Password rejected: ${problems.map((p) => PASSWORD_PROBLEM_MESSAGES[p]).join('; ')}`,
    );
  }
  const plan = input.plan ?? 'ENTERPRISE';

  const tenant = await db.tenant.upsert({
    where: { slug: input.slug },
    create: { slug: input.slug, name: input.name },
    update: {},
  });

  const existing = await db.user.findUnique({ where: { email } });
  const setPassword = !existing || !!input.resetPassword;
  const passwordFields = setPassword
    ? { passwordHash: await hashPassword(input.adminPassword), passwordChangedAt: new Date() }
    : {};
  const user = await db.user.upsert({
    where: { email },
    create: {
      email,
      displayName: input.adminName,
      isPlatformAdmin: !!input.platformAdmin,
      ...passwordFields,
    },
    update: {
      ...passwordFields,
      ...(input.platformAdmin ? { isPlatformAdmin: true } : {}),
      ...(setPassword ? { failedLoginCount: 0, lockedUntil: null } : {}),
    },
  });

  // Built-in roles (organisation administrator, auditor, …) for the organisation.
  await new RbacService().ensureSystemRoles(db, tenant.id);

  await db.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
    create: { tenantId: tenant.id, userId: user.id, isTenantAdmin: true },
    update: { isTenantAdmin: true, status: 'ACTIVE' },
  });

  await syncPlanCatalogue(db);
  const existingSubscription = await db.subscription.findUnique({ where: { tenantId: tenant.id } });
  if (!existingSubscription) {
    const version = await latestPublishedVersion(db, plan);
    if (!version) throw new BootstrapError(`No published version of plan ${plan}`);
    await db.subscription.create({
      data: {
        tenantId: tenant.id,
        planVersionId: version.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
      },
    });
    await db.subscriptionEvent.create({
      data: {
        tenantId: tenant.id,
        action: 'start',
        toStatus: 'ACTIVE',
        planVersionId: version.id,
        details: { source: 'bootstrap', plan },
      },
    });
  }

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

  return { tenant, email, createdUser: !existing };
}
