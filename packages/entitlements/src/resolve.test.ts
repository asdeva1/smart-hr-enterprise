import { describe, expect, it } from 'vitest';
import { ALL_FEATURES, PLAN_TEMPLATES } from './catalogue.js';
import {
  canWrite,
  effectiveStatus,
  hasFeature,
  limitOf,
  resolveEntitlements,
  withinLimit,
  type PlanState,
  type SubscriptionState,
} from './resolve.js';

const NOW = new Date('2026-10-14T00:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const pro: PlanState = {
  code: 'PRO',
  name: 'Pro',
  version: 2,
  features: ['hr.core', 'recruitment', 'expenses'],
  limits: { 'employees.max': 300, 'ai.tokens.monthly': 1000, 'storage.gb': null },
  graceDays: 14,
};

function sub(partial: Partial<SubscriptionState>): SubscriptionState {
  return { status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: null, graceEndsAt: null, ...partial };
}

describe('effectiveStatus', () => {
  it('keeps a running trial and moves a lapsed one into grace, then expiry', () => {
    expect(effectiveStatus(sub({ status: 'TRIAL', trialEndsAt: day(3) }), 14, NOW).status).toBe('TRIAL');
    const grace = effectiveStatus(sub({ status: 'TRIAL', trialEndsAt: day(-1) }), 14, NOW);
    expect(grace.status).toBe('GRACE');
    expect(grace.graceEndsAt?.toISOString()).toBe(day(13).toISOString());
    expect(effectiveStatus(sub({ status: 'TRIAL', trialEndsAt: day(-15) }), 14, NOW).status).toBe('EXPIRED');
  });

  it('treats an open-ended active subscription as active', () => {
    expect(effectiveStatus(sub({}), 14, NOW).status).toBe('ACTIVE');
  });

  it('ends a cancelled subscription at the end of its period, with no grace', () => {
    expect(effectiveStatus(sub({ status: 'CANCELLED', currentPeriodEnd: day(5) }), 14, NOW).status).toBe(
      'ACTIVE',
    );
    expect(effectiveStatus(sub({ status: 'CANCELLED', currentPeriodEnd: day(-1) }), 14, NOW).status).toBe(
      'EXPIRED',
    );
  });

  it('honours an explicit grace deadline for past-due subscriptions', () => {
    expect(effectiveStatus(sub({ status: 'PAST_DUE', graceEndsAt: day(2) }), 14, NOW).status).toBe(
      'PAST_DUE',
    );
    expect(effectiveStatus(sub({ status: 'PAST_DUE', graceEndsAt: day(-1) }), 14, NOW).status).toBe(
      'EXPIRED',
    );
  });
});

describe('per-employee licences', () => {
  it('caps the employee limit at the number bought, never above the plan', () => {
    const at = (licensedEmployees: number | null, planCap: number | null) =>
      resolveEntitlements({
        plan: { ...pro, limits: { 'employees.max': planCap } },
        subscription: sub({ licensedEmployees }),
        now: NOW,
      }).limits['employees.max'];
    expect(at(40, null)).toBe(40); // plan has no cap of its own: the licence is the cap
    expect(at(40, 300)).toBe(40);
    expect(at(500, 300)).toBe(300); // buying more than the plan allows doesn't lift the plan's cap
    expect(at(null, 300)).toBe(300); // no licence recorded: the plan limit applies
  });
});

describe('AI allowance per employee', () => {
  const plan: PlanState = {
    ...pro,
    limits: { 'employees.max': null, 'ai.tokens.monthly': 1_000, 'ai.tokens.per_employee': 5_000 },
  };
  it('multiplies the per-employee allowance by the employees bought', () => {
    const e = resolveEntitlements({ plan, subscription: sub({ licensedEmployees: 40 }), now: NOW });
    expect(e.limits['ai.tokens.monthly']).toBe(200_000);
  });
  it("keeps the plan's monthly pool when no headcount was bought", () => {
    const e = resolveEntitlements({ plan, subscription: sub({}), now: NOW });
    expect(e.limits['ai.tokens.monthly']).toBe(1_000);
  });
});

describe('resolveEntitlements', () => {
  it('gives full access to plan features while active', () => {
    const e = resolveEntitlements({ plan: pro, subscription: sub({}), now: NOW });
    expect(e.access).toBe('FULL');
    expect(canWrite(e, 'recruitment')).toBe(true);
    expect(hasFeature(e, 'payroll')).toBe(false);
  });

  it('turns expired and suspended organisations read-only but keeps their features readable', () => {
    for (const status of ['EXPIRED', 'SUSPENDED'] as const) {
      const e = resolveEntitlements({ plan: pro, subscription: sub({ status }), now: NOW });
      expect(e.access).toBe('READ_ONLY');
      expect(hasFeature(e, 'recruitment')).toBe(true);
      expect(canWrite(e, 'recruitment')).toBe(false);
    }
  });

  it('gives nothing gated without a subscription', () => {
    const e = resolveEntitlements({ plan: null, subscription: null, now: NOW });
    expect(e.access).toBe('NONE');
    expect(e.features).toEqual([]);
  });

  it('adds add-on features and multiplies limit increments by quantity', () => {
    const e = resolveEntitlements({
      plan: pro,
      subscription: sub({}),
      addons: [
        { code: 'PAYROLL', features: ['payroll'], limits: {}, quantity: 1 },
        { code: 'AI_PACK', features: [], limits: { 'ai.tokens.monthly': 500 }, quantity: 3 },
        { code: 'UNUSED', features: ['finance'], limits: {}, quantity: 0 },
      ],
      now: NOW,
    });
    expect(hasFeature(e, 'payroll')).toBe(true);
    expect(hasFeature(e, 'finance')).toBe(false);
    expect(limitOf(e, 'ai.tokens.monthly')).toBe(2500);
    expect(limitOf(e, 'storage.gb')).toBeNull();
  });

  it('applies overrides last: grant, revoke and exact limits', () => {
    const e = resolveEntitlements({
      plan: pro,
      subscription: sub({}),
      overrides: [
        { kind: 'FEATURE', key: 'finance', enabled: true },
        { kind: 'FEATURE', key: 'expenses', enabled: false },
        { kind: 'LIMIT', key: 'employees.max', value: 350 },
        { kind: 'FEATURE', key: 'not.a.feature', enabled: true },
      ],
      now: NOW,
    });
    expect(hasFeature(e, 'finance')).toBe(true);
    expect(hasFeature(e, 'expenses')).toBe(false);
    expect(withinLimit(e, 'employees.max', 350)).toBe(true);
    expect(withinLimit(e, 'employees.max', 351)).toBe(false);
    expect(e.features).not.toContain('not.a.feature');
  });

  it('treats a missing limit as unlimited', () => {
    const e = resolveEntitlements({ plan: { ...pro, limits: {} }, subscription: sub({}), now: NOW });
    expect(withinLimit(e, 'users.max', 1_000_000)).toBe(true);
  });
});

describe('plan templates', () => {
  it('are nested: every plan includes the one below it', () => {
    for (let i = 1; i < PLAN_TEMPLATES.length; i++) {
      const lower = PLAN_TEMPLATES[i - 1]!.features;
      const higher = new Set(PLAN_TEMPLATES[i]!.features);
      expect(lower.filter((f) => !higher.has(f))).toEqual([]);
    }
  });

  it('give Enterprise every feature and carry no prices', () => {
    const enterprise = PLAN_TEMPLATES.find((p) => p.code === 'ENTERPRISE')!;
    expect([...enterprise.features].sort()).toEqual([...ALL_FEATURES].sort());
    for (const plan of PLAN_TEMPLATES) expect(Object.keys(plan)).not.toContain('price');
  });
});
