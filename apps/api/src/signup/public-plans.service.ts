import { Inject, Injectable } from '@nestjs/common';
import { withContext, type DatabaseClient } from '@smart-hr/database';
import { FEATURES, isFeature, LIMITS, isLimitKey } from '@smart-hr/entitlements';
import { DATABASE } from '../infra/tokens.js';

/** Plans that are never listed publicly: the free demo is offered through its own button. */
const HIDDEN_PLAN_CODES = new Set(['DEMO']);

export interface PublicPlan {
  code: string;
  name: string;
  description: string | null;
  trialDays: number;
  supportLevel: string;
  /** Feature labels grouped by module, in catalogue order. */
  modules: { module: string; features: string[] }[];
  limits: { label: string; value: number | null; unit: string }[];
  /** Empty until an operator sets prices; the website then shows "Contact us". */
  prices: { currency: string; billingPeriod: string; pricingModel: string; amount: string }[];
}

/**
 * What the marketing website shows: the published plans, read from the live catalogue so that a price or
 * feature change by a platform operator shows up on the site without a code change. Nothing here is
 * specific to any organisation.
 */
@Injectable()
export class PublicPlansService {
  constructor(@Inject(DATABASE) private readonly db: DatabaseClient) {}

  async list(): Promise<PublicPlan[]> {
    const plans = await withContext(this.db, { platformActor: true }, (tx) =>
      tx.plan.findMany({
        where: { status: 'ACTIVE', code: { notIn: [...HIDDEN_PLAN_CODES] } },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        include: {
          versions: {
            where: { status: 'PUBLISHED' },
            orderBy: { version: 'desc' },
            take: 1,
            include: { prices: { orderBy: [{ currency: 'asc' }, { billingPeriod: 'asc' }] } },
          },
        },
      }),
    );

    const result: PublicPlan[] = [];
    for (const plan of plans) {
      const version = plan.versions[0];
      if (!version) continue;
      const byModule = new Map<string, string[]>();
      for (const code of version.features) {
        if (!isFeature(code)) continue;
        const { module, label } = FEATURES[code];
        byModule.set(module, [...(byModule.get(module) ?? []), label]);
      }
      const stored = (version.limits ?? {}) as Record<string, number | null>;
      result.push({
        code: plan.code,
        name: plan.name,
        description: plan.description,
        trialDays: version.trialDays,
        supportLevel: version.supportLevel,
        modules: [...byModule].map(([module, features]) => ({ module, features })),
        limits: Object.entries(stored)
          .filter(([key]) => isLimitKey(key))
          .map(([key, value]) => {
            const limit = LIMITS[key as keyof typeof LIMITS];
            return { label: limit.label, value: value ?? null, unit: limit.unit };
          }),
        prices: version.prices.map((p) => ({
          currency: p.currency,
          billingPeriod: p.billingPeriod,
          pricingModel: p.pricingModel,
          amount: p.amount.toString(),
        })),
      });
    }
    return result;
  }
}
