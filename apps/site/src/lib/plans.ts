import { z } from 'zod';

/** What GET /v1/public/plans returns. Parsed, so a changed API shows "contact us" and not a broken page. */
const planSchema = z.object({
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  trialDays: z.number(),
  supportLevel: z.string(),
  modules: z.array(z.object({ module: z.string(), features: z.array(z.string()) })),
  limits: z.array(z.object({ label: z.string(), value: z.number().nullable(), unit: z.string() })),
  prices: z.array(
    z.object({
      currency: z.string(),
      billingPeriod: z.enum(['MONTHLY', 'ANNUAL']),
      pricingModel: z.enum(['PER_USER', 'PER_EMPLOYEE', 'FLAT']),
      amount: z.string(),
    }),
  ),
});
export type PublicPlan = z.infer<typeof planSchema>;

/** The published plans, or null when the API can't be reached (the page then offers "contact us"). */
export async function loadPlans(): Promise<PublicPlan[] | null> {
  const base = process.env.API_PROXY_TARGET?.replace(/\/+$/, '');
  if (!base) return null;
  try {
    const res = await fetch(`${base}/v1/public/plans`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const parsed = z.object({ plans: z.array(planSchema) }).safeParse(await res.json());
    return parsed.success ? parsed.data.plans : null;
  } catch {
    return null;
  }
}

export function priceFor(plan: PublicPlan, period: 'MONTHLY' | 'ANNUAL') {
  return plan.prices.find((p) => p.currency === 'INR' && p.billingPeriod === period) ?? null;
}

const UNIT: Record<string, string> = {
  PER_USER: 'per member',
  PER_EMPLOYEE: 'per employee',
  FLAT: 'flat',
};

export function formatPrice(amount: string, model: string, period: 'MONTHLY' | 'ANNUAL'): string {
  const rupees = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(amount));
  return `₹${rupees} ${UNIT[model] ?? ''} / ${period === 'ANNUAL' ? 'year' : 'month'}`.replace('  ', ' ');
}
