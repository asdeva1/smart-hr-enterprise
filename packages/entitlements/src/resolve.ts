import { isFeature, isLimitKey, type Feature, type LimitKey, type Limits } from './catalogue.js';

/** Stored subscription states. EXPIRED and GRACE are also derived from dates, see `effectiveStatus`. */
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'SUSPENDED' | 'EXPIRED';

/** What the organisation can do right now. */
export type EffectiveStatus = 'NONE' | 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'GRACE' | 'EXPIRED' | 'SUSPENDED';

/**
 * FULL: gated modules work normally. READ_ONLY: gated modules can be read and exported but not changed.
 * Data is never deleted or hidden because a subscription lapsed.
 */
export type Access = 'FULL' | 'READ_ONLY' | 'NONE';

export interface SubscriptionState {
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  /** End of the paid period; null = open-ended (e.g. an enterprise contract invoiced offline). */
  currentPeriodEnd: Date | null;
  /** Explicit grace deadline set by an operator (e.g. after a failed payment). */
  graceEndsAt: Date | null;
}

export interface PlanState {
  code: string;
  name: string;
  version: number;
  features: readonly string[];
  limits: Limits;
  graceDays: number;
}

export interface AddonState {
  code: string;
  features: readonly string[];
  /** Increments added per unit of quantity; null = makes the limit unlimited. */
  limits: Limits;
  quantity: number;
}

export type OverrideState =
  { kind: 'FEATURE'; key: string; enabled: boolean } | { kind: 'LIMIT'; key: string; value: number | null };

export interface Entitlements {
  plan: { code: string; name: string; version: number } | null;
  status: EffectiveStatus;
  access: Access;
  features: Feature[];
  limits: Limits;
  trialEndsAt: string | null;
  periodEndsAt: string | null;
  /** When read-only begins, if the organisation is in a grace period. */
  graceEndsAt: string | null;
}

const DAY = 86_400_000;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY);
}

/** Status after applying dates: a trial or period that has ended moves to GRACE, then EXPIRED. */
export function effectiveStatus(
  sub: SubscriptionState | null,
  graceDays: number,
  now: Date,
): { status: EffectiveStatus; graceEndsAt: Date | null } {
  if (!sub) return { status: 'NONE', graceEndsAt: null };
  switch (sub.status) {
    case 'SUSPENDED':
      return { status: 'SUSPENDED', graceEndsAt: null };
    case 'EXPIRED':
      return { status: 'EXPIRED', graceEndsAt: null };
    case 'PAST_DUE': {
      const until =
        sub.graceEndsAt ?? (sub.currentPeriodEnd ? addDays(sub.currentPeriodEnd, graceDays) : null);
      if (until && now >= until) return { status: 'EXPIRED', graceEndsAt: null };
      return { status: 'PAST_DUE', graceEndsAt: until };
    }
    case 'TRIAL':
    case 'ACTIVE':
    case 'CANCELLED': {
      const end = sub.status === 'TRIAL' ? sub.trialEndsAt : sub.currentPeriodEnd;
      if (!end || now < end) {
        return { status: sub.status === 'TRIAL' ? 'TRIAL' : 'ACTIVE', graceEndsAt: null };
      }
      // A cancelled subscription simply ends; a lapsed trial or period gets the plan's grace.
      if (sub.status === 'CANCELLED') return { status: 'EXPIRED', graceEndsAt: null };
      const until = sub.graceEndsAt ?? addDays(end, graceDays);
      return now < until ? { status: 'GRACE', graceEndsAt: until } : { status: 'EXPIRED', graceEndsAt: null };
    }
  }
}

export function accessFor(status: EffectiveStatus): Access {
  switch (status) {
    case 'TRIAL':
    case 'ACTIVE':
    case 'PAST_DUE':
    case 'GRACE':
      return 'FULL';
    case 'EXPIRED':
    case 'SUSPENDED':
      return 'READ_ONLY';
    case 'NONE':
      return 'NONE';
  }
}

function addLimit(current: number | null | undefined, increment: number | null, quantity: number) {
  if (current === null || increment === null) return null;
  return (current ?? 0) + increment * quantity;
}

/**
 * Combines plan, add-ons and operator overrides into what the organisation is entitled to.
 * Order: plan → add-ons (features added, limits increased) → overrides (features granted or removed,
 * limits set to an exact value). Unknown keys are ignored, so a catalogue change can't break resolution.
 */
export function resolveEntitlements(input: {
  plan: PlanState | null;
  subscription: SubscriptionState | null;
  addons?: readonly AddonState[];
  overrides?: readonly OverrideState[];
  now: Date;
}): Entitlements {
  const { plan, subscription, now } = input;
  const { status, graceEndsAt } = effectiveStatus(subscription, plan?.graceDays ?? 0, now);
  const access = plan ? accessFor(status) : 'NONE';

  const features = new Set<Feature>();
  const limits: Limits = {};
  if (plan) {
    for (const f of plan.features) if (isFeature(f)) features.add(f);
    for (const [k, v] of Object.entries(plan.limits)) if (isLimitKey(k)) limits[k] = v ?? null;
    for (const addon of input.addons ?? []) {
      if (addon.quantity <= 0) continue;
      for (const f of addon.features) if (isFeature(f)) features.add(f);
      for (const [k, v] of Object.entries(addon.limits)) {
        if (isLimitKey(k)) limits[k] = addLimit(limits[k], v ?? null, addon.quantity);
      }
    }
    for (const o of input.overrides ?? []) {
      if (o.kind === 'FEATURE' && isFeature(o.key)) {
        if (o.enabled) features.add(o.key);
        else features.delete(o.key);
      } else if (o.kind === 'LIMIT' && isLimitKey(o.key)) {
        limits[o.key] = o.value;
      }
    }
  }

  return {
    plan: plan ? { code: plan.code, name: plan.name, version: plan.version } : null,
    status,
    access,
    features: access === 'NONE' ? [] : [...features].sort(),
    limits,
    trialEndsAt: subscription?.trialEndsAt?.toISOString() ?? null,
    periodEndsAt: subscription?.currentPeriodEnd?.toISOString() ?? null,
    graceEndsAt: graceEndsAt?.toISOString() ?? null,
  };
}

/** Whether a feature can be used at all (reading included). */
export function hasFeature(e: Entitlements, feature: Feature): boolean {
  return e.access !== 'NONE' && e.features.includes(feature);
}

/** Whether a feature can be used to change data. */
export function canWrite(e: Entitlements, feature: Feature): boolean {
  return e.access === 'FULL' && e.features.includes(feature);
}

/** The limit, or null for unlimited. */
export function limitOf(e: Entitlements, key: LimitKey): number | null {
  const value = e.limits[key];
  return value === undefined ? null : value;
}

/** True when having `wouldHave` of something stays within the limit. */
export function withinLimit(e: Entitlements, key: LimitKey, wouldHave: number): boolean {
  const limit = limitOf(e, key);
  return limit === null || wouldHave <= limit;
}
