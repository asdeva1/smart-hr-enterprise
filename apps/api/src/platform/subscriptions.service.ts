import { Inject, Injectable } from '@nestjs/common';
import {
  type DatabaseClient,
  type Prisma,
  type Subscription,
  type SubscriptionStatus,
  type TenantTransaction,
} from '@smart-hr/database';
import { AppError, NotFoundError } from '@smart-hr/shared';
import type {
  assignSubscriptionSchema,
  createOverrideSchema,
  setSubscriptionAddonSchema,
  subscriptionActionSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { DATABASE } from '../infra/tokens.js';
import { asPlatform } from './platform-context.js';

const DAY = 86_400_000;

/**
 * Organisation subscriptions, managed from the platform console. Every change is written to the
 * subscription's own history (subscription_event) and to the organisation's audit log in one transaction.
 * Nothing here deletes or hides organisation data: an expired or suspended organisation becomes read-only.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  private async event(
    tx: TenantTransaction,
    auth: AuthContext,
    tenantId: string,
    action: string,
    before: Pick<Subscription, 'status'> | null,
    after: Pick<Subscription, 'status' | 'planVersionId'>,
    details: Record<string, unknown>,
    meta: RequestMeta,
  ) {
    // Dates become ISO strings; nothing but plain JSON is stored.
    const clean = JSON.parse(JSON.stringify(details)) as Prisma.InputJsonObject;
    await tx.subscriptionEvent.create({
      data: {
        tenantId,
        action,
        fromStatus: before?.status ?? null,
        toStatus: after.status,
        planVersionId: after.planVersionId,
        actorUserId: auth.user.id,
        details: clean,
      },
    });
    await this.audit.recordInTransaction(
      tx,
      {
        action: `platform.subscription.${action}`,
        outcome: 'SUCCESS',
        tenantId,
        actorUserId: auth.user.id,
        targetType: 'subscription',
        targetId: tenantId,
        metadata: { from: before?.status ?? null, to: after.status, ...clean },
      },
      meta,
    );
  }

  private async tenantExists(tx: TenantTransaction, tenantId: string) {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } });
    if (!tenant) throw new NotFoundError('Organisation');
    return tenant;
  }

  /** Every organisation with its plan, for the platform console. */
  async listTenants(auth: AuthContext) {
    return asPlatform(this.db, auth, async (tx) => {
      const tenants = await tx.tenant.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          createdAt: true,
          subscription: {
            select: {
              status: true,
              trialEndsAt: true,
              currentPeriodEnd: true,
              planVersion: { select: { version: true, plan: { select: { code: true, name: true } } } },
            },
          },
        },
      });
      return tenants;
    });
  }

  async get(auth: AuthContext, tenantId: string) {
    return asPlatform(
      this.db,
      auth,
      async (tx) => {
        const tenant = await this.tenantExists(tx, tenantId);
        const subscription = await tx.subscription.findFirst({
          where: { tenantId },
          include: {
            planVersion: { include: { plan: { select: { id: true, code: true, name: true } } } },
            addons: { include: { addon: { select: { id: true, code: true, name: true, kind: true } } } },
          },
        });
        const overrides = await tx.entitlementOverride.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
        });
        const events = await tx.subscriptionEvent.findMany({
          where: { tenantId },
          orderBy: { occurredAt: 'desc' },
          take: 50,
        });
        const entitlements = await this.entitlements.forTenant(tx);
        const usage = await this.entitlements.usage(tx);
        return { tenant, subscription, overrides, events, entitlements, usage };
      },
      tenantId,
    );
  }

  /** Starts a subscription, or moves an organisation to another plan version. */
  async assign(
    auth: AuthContext,
    tenantId: string,
    input: z.output<typeof assignSubscriptionSchema>,
    meta: RequestMeta,
  ) {
    return asPlatform(
      this.db,
      auth,
      async (tx) => {
        await this.tenantExists(tx, tenantId);
        const version = await tx.planVersion.findUnique({ where: { id: input.planVersionId } });
        if (!version) throw new NotFoundError('Plan version');
        if (version.status !== 'PUBLISHED') {
          throw new AppError('VERSION_NOT_FOR_SALE', 'Only a published plan version can be assigned', 409, [
            { path: 'planVersionId', message: 'Choose a published version' },
          ]);
        }
        const now = new Date();
        let trialEndsAt: Date | null = null;
        if (input.status === 'TRIAL') {
          const days = input.trialDays ?? version.trialDays;
          if (days <= 0) {
            throw new AppError(
              'NO_TRIAL',
              'This plan has no trial. Set trial days or start it as active.',
              422,
              [{ path: 'trialDays', message: 'Enter the trial length' }],
            );
          }
          trialEndsAt = new Date(now.getTime() + days * DAY);
        }
        const data = {
          planVersionId: version.id,
          status: input.status,
          billingPeriod: input.billingPeriod,
          currency: input.currency,
          trialEndsAt,
          currentPeriodStart: input.status === 'ACTIVE' ? now : null,
          currentPeriodEnd: input.status === 'ACTIVE' ? (input.currentPeriodEnd ?? null) : null,
          graceEndsAt: null,
          cancelledAt: null,
        } satisfies Partial<Subscription>;

        await tx.$queryRaw`SELECT 1 FROM tenant WHERE id = ${tenantId}::uuid FOR UPDATE`;
        const before = await tx.subscription.findFirst({ where: { tenantId } });
        const after = before
          ? await tx.subscription.update({ where: { id: before.id }, data })
          : await tx.subscription.create({ data: { tenantId, ...data } });
        await this.event(
          tx,
          auth,
          tenantId,
          before ? 'change_plan' : 'start',
          before,
          after,
          {
            fromPlanVersionId: before?.planVersionId ?? null,
            trialEndsAt,
            currentPeriodEnd: after.currentPeriodEnd,
            reason: input.reason ?? null,
          },
          meta,
        );
        return after;
      },
      tenantId,
    );
  }

  async act(
    auth: AuthContext,
    tenantId: string,
    input: z.output<typeof subscriptionActionSchema>,
    meta: RequestMeta,
  ) {
    return asPlatform(
      this.db,
      auth,
      async (tx) => {
        await this.tenantExists(tx, tenantId);
        await tx.$queryRaw`SELECT 1 FROM subscription WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`;
        const before = await tx.subscription.findFirst({ where: { tenantId } });
        if (!before) throw new AppError('NO_SUBSCRIPTION', 'This organisation has no subscription yet', 409);
        const now = new Date();
        const conflict = (message: string) => new AppError('INVALID_TRANSITION', message, 409);
        let data: Partial<Subscription> & { status: SubscriptionStatus };

        switch (input.action) {
          case 'renew': {
            const from =
              before.currentPeriodEnd && before.currentPeriodEnd > now ? before.currentPeriodEnd : now;
            if (input.currentPeriodEnd <= from) {
              throw new AppError('INVALID_PERIOD', 'The new period must end after it starts', 422, [
                { path: 'currentPeriodEnd', message: `Must be after ${from.toISOString()}` },
              ]);
            }
            data = {
              status: 'ACTIVE',
              currentPeriodStart: from,
              currentPeriodEnd: input.currentPeriodEnd,
              trialEndsAt: null,
              graceEndsAt: null,
              cancelledAt: null,
            };
            break;
          }
          case 'mark_past_due':
            if (!['ACTIVE', 'PAST_DUE'].includes(before.status)) {
              throw conflict('Only an active subscription can be marked past due');
            }
            data = { status: 'PAST_DUE', graceEndsAt: input.graceEndsAt };
            break;
          case 'suspend':
            if (before.status === 'SUSPENDED') throw conflict('Already suspended');
            data = { status: 'SUSPENDED' };
            break;
          case 'reactivate':
            if (!['SUSPENDED', 'PAST_DUE'].includes(before.status)) {
              throw conflict(
                'Only a suspended or past-due subscription can be reactivated. Renew an ended one.',
              );
            }
            data = { status: 'ACTIVE', graceEndsAt: null };
            break;
          case 'cancel':
            if (['CANCELLED', 'EXPIRED'].includes(before.status)) throw conflict('Already ended');
            // Access continues to the end of the paid period; open-ended contracts end now.
            data = {
              status: 'CANCELLED',
              cancelledAt: now,
              currentPeriodEnd:
                before.status === 'TRIAL' ? (before.trialEndsAt ?? now) : (before.currentPeriodEnd ?? now),
            };
            break;
        }

        const after = await tx.subscription.update({ where: { id: before.id }, data });
        await this.event(tx, auth, tenantId, input.action, before, after, { ...input }, meta);
        return after;
      },
      tenantId,
    );
  }

  async setAddon(
    auth: AuthContext,
    tenantId: string,
    input: z.output<typeof setSubscriptionAddonSchema>,
    meta: RequestMeta,
  ) {
    return asPlatform(
      this.db,
      auth,
      async (tx) => {
        const sub = await tx.subscription.findFirst({ where: { tenantId } });
        if (!sub) throw new AppError('NO_SUBSCRIPTION', 'This organisation has no subscription yet', 409);
        const addon = await tx.addon.findUnique({ where: { id: input.addonId } });
        if (!addon) throw new NotFoundError('Add-on');
        if (input.quantity === 0) {
          await tx.subscriptionAddon.deleteMany({ where: { subscriptionId: sub.id, addonId: addon.id } });
        } else {
          if (addon.status !== 'ACTIVE') {
            throw new AppError('ADDON_ARCHIVED', 'This add-on is no longer sold', 409);
          }
          await tx.subscriptionAddon.upsert({
            where: { subscriptionId_addonId: { subscriptionId: sub.id, addonId: addon.id } },
            create: { tenantId, subscriptionId: sub.id, addonId: addon.id, quantity: input.quantity },
            update: { quantity: input.quantity },
          });
        }
        await this.event(
          tx,
          auth,
          tenantId,
          'addon',
          sub,
          sub,
          { addon: addon.code, quantity: input.quantity },
          meta,
        );
        return { addon: addon.code, quantity: input.quantity };
      },
      tenantId,
    );
  }

  async createOverride(
    auth: AuthContext,
    tenantId: string,
    input: z.output<typeof createOverrideSchema>,
    meta: RequestMeta,
  ) {
    return asPlatform(
      this.db,
      auth,
      async (tx) => {
        await this.tenantExists(tx, tenantId);
        const override = await tx.entitlementOverride.create({
          data: {
            tenantId,
            kind: input.kind,
            key: input.key,
            enabled: input.kind === 'FEATURE' ? input.enabled : null,
            value: input.kind === 'LIMIT' ? input.value : null,
            reason: input.reason,
            expiresAt: input.expiresAt ?? null,
            createdByUserId: auth.user.id,
          },
        });
        await this.audit.recordInTransaction(
          tx,
          {
            action: 'platform.entitlement_override.create',
            outcome: 'SUCCESS',
            tenantId,
            actorUserId: auth.user.id,
            targetType: 'entitlement_override',
            targetId: override.id,
            metadata: { kind: input.kind, key: input.key, reason: input.reason },
          },
          meta,
        );
        return override;
      },
      tenantId,
    );
  }

  async revokeOverride(auth: AuthContext, tenantId: string, overrideId: string, meta: RequestMeta) {
    return asPlatform(
      this.db,
      auth,
      async (tx) => {
        const existing = await tx.entitlementOverride.findFirst({ where: { id: overrideId, tenantId } });
        if (!existing) throw new NotFoundError('Override');
        if (existing.revokedAt) return existing;
        const revoked = await tx.entitlementOverride.update({
          where: { id: overrideId },
          data: { revokedAt: new Date() },
        });
        await this.audit.recordInTransaction(
          tx,
          {
            action: 'platform.entitlement_override.revoke',
            outcome: 'SUCCESS',
            tenantId,
            actorUserId: auth.user.id,
            targetType: 'entitlement_override',
            targetId: overrideId,
            metadata: { kind: existing.kind, key: existing.key },
          },
          meta,
        );
        return revoked;
      },
      tenantId,
    );
  }
}
