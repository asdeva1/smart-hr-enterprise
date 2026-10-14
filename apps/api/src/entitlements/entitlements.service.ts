import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '@smart-hr/database';
import {
  canWrite,
  hasFeature,
  isLimitKey,
  LIMITS,
  limitOf,
  resolveEntitlements,
  withinLimit,
  type Entitlements,
  type Feature,
  type LimitKey,
  type Limits,
  type OverrideState,
} from '@smart-hr/entitlements';
import { AppError } from '@smart-hr/shared';

/** Counts current usage of a limited resource, inside the tenant's transaction. */
export type UsageCounter = (tx: TenantTransaction) => Promise<number>;

function asLimits(value: unknown): Limits {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const limits: Limits = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (isLimitKey(key) && (v === null || typeof v === 'number')) limits[key] = v;
  }
  return limits;
}

/**
 * Resolves what an organisation's plan, add-ons and overrides entitle it to, and enforces it.
 * Every check runs inside the caller's tenant transaction (RLS on): an organisation only ever sees its own
 * subscription. Frontend visibility is never the check — the API calls these on every gated request.
 */
@Injectable()
export class EntitlementsService {
  private readonly counters = new Map<LimitKey, UsageCounter>();

  constructor() {
    this.registerUsage('users.max', (tx) => tx.tenantMembership.count({ where: { status: 'ACTIVE' } }));
    this.registerUsage('companies.max', (tx) => tx.company.count({ where: { status: 'ACTIVE' } }));
  }

  /** Modules register how to count what they own (employees, storage, workspaces, …). */
  registerUsage(key: LimitKey, counter: UsageCounter): void {
    this.counters.set(key, counter);
  }

  async forTenant(tx: TenantTransaction, now = new Date()): Promise<Entitlements> {
    const sub = await tx.subscription.findFirst({
      include: {
        planVersion: { include: { plan: { select: { code: true, name: true } } } },
        addons: {
          include: { addon: { select: { code: true, features: true, limits: true, status: true } } },
        },
      },
    });
    const overrides = await tx.entitlementOverride.findMany({
      where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: { createdAt: 'asc' },
    });
    return resolveEntitlements({
      plan: sub
        ? {
            code: sub.planVersion.plan.code,
            name: sub.planVersion.plan.name,
            version: sub.planVersion.version,
            features: sub.planVersion.features,
            limits: asLimits(sub.planVersion.limits),
            graceDays: sub.planVersion.graceDays,
          }
        : null,
      subscription: sub
        ? {
            status: sub.status,
            trialEndsAt: sub.trialEndsAt,
            currentPeriodEnd: sub.currentPeriodEnd,
            graceEndsAt: sub.graceEndsAt,
          }
        : null,
      addons: (sub?.addons ?? [])
        .filter((a) => a.addon.status === 'ACTIVE')
        .map((a) => ({
          code: a.addon.code,
          features: a.addon.features,
          limits: asLimits(a.addon.limits),
          quantity: a.quantity,
        })),
      overrides: overrides.map((o): OverrideState =>
        o.kind === 'FEATURE'
          ? { kind: 'FEATURE', key: o.key, enabled: o.enabled ?? false }
          : { kind: 'LIMIT', key: o.key, value: o.value },
      ),
      now,
    });
  }

  /**
   * Refuses use of a feature the plan doesn't include, and refuses changes when the organisation is read-only
   * (subscription expired or suspended). Reading and exporting stay possible: data is never held hostage.
   */
  assertFeature(e: Entitlements, feature: Feature, write: boolean): void {
    if (!hasFeature(e, feature)) {
      throw new AppError(
        'ENTITLEMENT_REQUIRED',
        'Your organisation’s plan doesn’t include this. Ask your administrator about upgrading.',
        403,
        [{ path: 'feature', message: feature }],
      );
    }
    if (write && !canWrite(e, feature)) {
      throw new AppError(
        'SUBSCRIPTION_READ_ONLY',
        e.status === 'SUSPENDED'
          ? 'Your organisation’s subscription is suspended. You can view and export data, but not change it.'
          : 'Your organisation’s subscription has ended. You can view and export data, but not change it.',
        403,
      );
    }
  }

  async usage(tx: TenantTransaction): Promise<Partial<Record<LimitKey, number>>> {
    const result: Partial<Record<LimitKey, number>> = {};
    for (const [key, counter] of this.counters) result[key] = await counter(tx);
    return result;
  }

  /**
   * Refuses an action that would take usage past the plan's limit. Call inside the same transaction that
   * creates the thing, so the count and the insert agree.
   */
  async assertWithinLimit(tx: TenantTransaction, key: LimitKey, adding = 1): Promise<void> {
    // Serialise checks for the same limit in the same organisation until this transaction ends, so two
    // concurrent requests can't both see room for one more.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`limit:${key}`}), hashtext(current_setting('app.tenant_id')))`;
    const e = await this.forTenant(tx);
    const counter = this.counters.get(key);
    if (!counter) throw new Error(`No usage counter registered for ${key}`);
    const current = await counter(tx);
    if (!withinLimit(e, key, current + adding)) {
      const limit = limitOf(e, key);
      throw new AppError(
        'LIMIT_REACHED',
        `Your plan allows ${limit} ${LIMITS[key].unit}, and your organisation is using ${current}. Ask your administrator about a higher limit.`,
        403,
        [{ path: 'limit', message: key }],
      );
    }
  }
}
