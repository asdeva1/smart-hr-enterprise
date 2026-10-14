import { Inject, Injectable } from '@nestjs/common';
import {
  isUniqueViolation,
  type DatabaseClient,
  type Prisma,
  type TenantTransaction,
} from '@smart-hr/database';
import { AppError, NotFoundError } from '@smart-hr/shared';
import type {
  createAddonSchema,
  createPlanSchema,
  updateAddonSchema,
  updatePlanVersionSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { DATABASE } from '../infra/tokens.js';
import { asPlatform } from './platform-context.js';

const VERSION_INCLUDE = {
  prices: { orderBy: [{ currency: 'asc' }, { billingPeriod: 'asc' }] },
  _count: { select: { subscriptions: true } },
} satisfies Prisma.PlanVersionInclude;

/**
 * The plan catalogue, maintained by platform operators. Drafts are edited freely; publishing freezes a
 * version (the database refuses later changes) so existing subscriptions keep their terms. A change to a
 * published plan is a new version.
 */
@Injectable()
export class PlansService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly audit: AuditService,
  ) {}

  private record(
    tx: TenantTransaction,
    auth: AuthContext,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown>,
    meta: RequestMeta,
  ) {
    return this.audit.recordInTransaction(
      tx,
      { action, outcome: 'SUCCESS', actorUserId: auth.user.id, targetType, targetId, metadata },
      meta,
    );
  }

  async list(auth: AuthContext) {
    return asPlatform(this.db, auth, (tx) =>
      tx.plan.findMany({
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        include: { versions: { orderBy: { version: 'desc' }, include: VERSION_INCLUDE } },
      }),
    );
  }

  async get(auth: AuthContext, planId: string) {
    const plan = await asPlatform(this.db, auth, (tx) =>
      tx.plan.findUnique({
        where: { id: planId },
        include: { versions: { orderBy: { version: 'desc' }, include: VERSION_INCLUDE } },
      }),
    );
    if (!plan) throw new NotFoundError('Plan');
    return plan;
  }

  async create(auth: AuthContext, input: z.output<typeof createPlanSchema>, meta: RequestMeta) {
    try {
      return await asPlatform(this.db, auth, async (tx) => {
        const plan = await tx.plan.create({
          data: {
            code: input.code,
            name: input.name,
            description: input.description ?? null,
            sortOrder: input.sortOrder,
            versions: { create: { version: 1, features: [], limits: {}, deploymentModels: ['SAAS'] } },
          },
        });
        await this.record(tx, auth, 'platform.plan.create', 'plan', plan.id, { code: plan.code }, meta);
        return plan;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError('CODE_TAKEN', 'That plan code is already used', 409, [
          { path: 'code', message: 'Already used' },
        ]);
      }
      throw error;
    }
  }

  /** Starts a new draft from the plan's newest version. One draft per plan at a time. */
  async createDraft(auth: AuthContext, planId: string, meta: RequestMeta) {
    return asPlatform(this.db, auth, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM plan WHERE id = ${planId}::uuid FOR UPDATE`;
      const latest = await tx.planVersion.findFirst({
        where: { planId },
        orderBy: { version: 'desc' },
        include: { prices: true },
      });
      if (!latest) throw new NotFoundError('Plan');
      if (latest.status === 'DRAFT') {
        throw new AppError(
          'DRAFT_EXISTS',
          'This plan already has a draft version. Edit or delete it first.',
          409,
        );
      }
      const draft = await tx.planVersion.create({
        data: {
          planId,
          version: latest.version + 1,
          features: latest.features,
          limits: latest.limits ?? {},
          trialDays: latest.trialDays,
          graceDays: latest.graceDays,
          supportLevel: latest.supportLevel,
          deploymentModels: latest.deploymentModels,
          notes: null,
          createdByUserId: auth.user.id,
          prices: {
            create: latest.prices.map((p) => ({
              currency: p.currency,
              billingPeriod: p.billingPeriod,
              pricingModel: p.pricingModel,
              amount: p.amount,
            })),
          },
        },
        include: VERSION_INCLUDE,
      });
      await this.record(
        tx,
        auth,
        'platform.plan_version.draft',
        'plan_version',
        draft.id,
        { planId, version: draft.version },
        meta,
      );
      return draft;
    });
  }

  private async draft(tx: TenantTransaction, versionId: string) {
    await tx.$queryRaw`SELECT 1 FROM plan_version WHERE id = ${versionId}::uuid FOR UPDATE`;
    const version = await tx.planVersion.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundError('Plan version');
    if (version.status !== 'DRAFT') {
      throw new AppError(
        'VERSION_FROZEN',
        'Published versions can’t be changed. Create a new draft instead.',
        409,
      );
    }
    return version;
  }

  async updateDraft(
    auth: AuthContext,
    versionId: string,
    input: z.output<typeof updatePlanVersionSchema>,
    meta: RequestMeta,
  ) {
    return asPlatform(this.db, auth, async (tx) => {
      await this.draft(tx, versionId);
      if (input.prices) {
        await tx.planPrice.deleteMany({ where: { planVersionId: versionId } });
        await tx.planPrice.createMany({
          data: input.prices.map((p) => ({ planVersionId: versionId, ...p })),
        });
      }
      const updated = await tx.planVersion.update({
        where: { id: versionId },
        data: {
          ...(input.features !== undefined ? { features: input.features } : {}),
          ...(input.limits !== undefined ? { limits: input.limits } : {}),
          ...(input.trialDays !== undefined ? { trialDays: input.trialDays } : {}),
          ...(input.graceDays !== undefined ? { graceDays: input.graceDays } : {}),
          ...(input.supportLevel !== undefined ? { supportLevel: input.supportLevel } : {}),
          ...(input.deploymentModels !== undefined ? { deploymentModels: input.deploymentModels } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
        include: VERSION_INCLUDE,
      });
      await this.record(
        tx,
        auth,
        'platform.plan_version.update',
        'plan_version',
        versionId,
        { changed: Object.keys(input) },
        meta,
      );
      return updated;
    });
  }

  async publish(auth: AuthContext, versionId: string, meta: RequestMeta) {
    return asPlatform(this.db, auth, async (tx) => {
      const version = await this.draft(tx, versionId);
      if (version.features.length === 0) {
        throw new AppError('EMPTY_PLAN', 'Add at least one feature before publishing', 422);
      }
      if (version.deploymentModels.length === 0) {
        throw new AppError('NO_DEPLOYMENT_MODEL', 'Choose at least one deployment model', 422);
      }
      const published = await tx.planVersion.update({
        where: { id: versionId },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
        include: VERSION_INCLUDE,
      });
      await this.record(
        tx,
        auth,
        'platform.plan_version.publish',
        'plan_version',
        versionId,
        { planId: version.planId, version: version.version },
        meta,
      );
      return published;
    });
  }

  /** Stops selling a version. Organisations already on it keep it until moved. */
  async retire(auth: AuthContext, versionId: string, meta: RequestMeta) {
    return asPlatform(this.db, auth, async (tx) => {
      const version = await tx.planVersion.findUnique({ where: { id: versionId } });
      if (!version) throw new NotFoundError('Plan version');
      if (version.status !== 'PUBLISHED') {
        throw new AppError('NOT_PUBLISHED', 'Only a published version can be retired', 409);
      }
      const retired = await tx.planVersion.update({
        where: { id: versionId },
        data: { status: 'RETIRED', retiredAt: new Date() },
        include: VERSION_INCLUDE,
      });
      await this.record(tx, auth, 'platform.plan_version.retire', 'plan_version', versionId, {}, meta);
      return retired;
    });
  }

  async deleteDraft(auth: AuthContext, versionId: string, meta: RequestMeta) {
    await asPlatform(this.db, auth, async (tx) => {
      const version = await this.draft(tx, versionId);
      await tx.planVersion.delete({ where: { id: versionId } });
      await this.record(
        tx,
        auth,
        'platform.plan_version.delete',
        'plan_version',
        versionId,
        { planId: version.planId, version: version.version },
        meta,
      );
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Add-ons

  async listAddons(auth: AuthContext) {
    return asPlatform(this.db, auth, (tx) =>
      tx.addon.findMany({
        orderBy: { code: 'asc' },
        include: {
          prices: { orderBy: [{ currency: 'asc' }, { billingPeriod: 'asc' }] },
          _count: { select: { subscriptions: true } },
        },
      }),
    );
  }

  async createAddon(auth: AuthContext, input: z.output<typeof createAddonSchema>, meta: RequestMeta) {
    try {
      return await asPlatform(this.db, auth, async (tx) => {
        const addon = await tx.addon.create({
          data: {
            code: input.code,
            name: input.name,
            description: input.description ?? null,
            kind: input.kind,
            features: input.features,
            limits: input.limits,
            prices: { create: input.prices },
          },
          include: { prices: true },
        });
        await this.record(tx, auth, 'platform.addon.create', 'addon', addon.id, { code: addon.code }, meta);
        return addon;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError('CODE_TAKEN', 'That add-on code is already used', 409, [
          { path: 'code', message: 'Already used' },
        ]);
      }
      throw error;
    }
  }

  async updateAddon(
    auth: AuthContext,
    addonId: string,
    input: z.output<typeof updateAddonSchema>,
    meta: RequestMeta,
  ) {
    return asPlatform(this.db, auth, async (tx) => {
      const existing = await tx.addon.findUnique({ where: { id: addonId } });
      if (!existing) throw new NotFoundError('Add-on');
      if (input.prices) {
        await tx.addonPrice.deleteMany({ where: { addonId } });
        await tx.addonPrice.createMany({ data: input.prices.map((p) => ({ addonId, ...p })) });
      }
      const addon = await tx.addon.update({
        where: { id: addonId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.features !== undefined ? { features: input.features } : {}),
          ...(input.limits !== undefined ? { limits: input.limits } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
        include: { prices: true },
      });
      await this.record(
        tx,
        auth,
        'platform.addon.update',
        'addon',
        addonId,
        { changed: Object.keys(input) },
        meta,
      );
      return addon;
    });
  }
}
