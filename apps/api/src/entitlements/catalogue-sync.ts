import type { DatabaseClient, TenantTransaction } from '@smart-hr/database';
import { PLAN_TEMPLATES } from '@smart-hr/entitlements';

type Client = DatabaseClient | TenantTransaction;

/**
 * Makes sure every plan in the starting catalogue exists, with a published version 1 if it has no versions.
 * Never touches a plan or version that exists: operators own the catalogue once it is there.
 * Idempotent; runs at bootstrap and on every deployment.
 */
export async function syncPlanCatalogue(db: Client): Promise<{ created: string[] }> {
  const created: string[] = [];
  for (const template of PLAN_TEMPLATES) {
    const plan = await db.plan.upsert({
      where: { code: template.code },
      create: {
        code: template.code,
        name: template.name,
        description: template.description,
        sortOrder: template.sortOrder,
      },
      update: {},
      select: { id: true, _count: { select: { versions: true } } },
    });
    if (plan._count.versions > 0) continue;
    await db.planVersion.create({
      data: {
        planId: plan.id,
        version: 1,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        features: template.features,
        limits: template.limits,
        trialDays: template.trialDays,
        graceDays: template.graceDays,
        supportLevel: template.supportLevel,
        deploymentModels: template.deploymentModels,
        notes: 'Starting catalogue. Prices are set by platform operators.',
      },
    });
    created.push(template.code);
  }
  return { created };
}

/** The newest published version of a plan, for assigning plans by code (bootstrap, tests). */
export async function latestPublishedVersion(db: Client, planCode: string) {
  return db.planVersion.findFirst({
    where: { plan: { code: planCode }, status: 'PUBLISHED' },
    orderBy: { version: 'desc' },
  });
}
