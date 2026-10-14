import { DEPLOYMENT_MODELS, isFeature, isLimitKey, SUPPORT_LEVELS } from '@smart-hr/entitlements';
import { z } from 'zod';

export const planCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'Use 2–30 capital letters, digits or _');

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code');

/** Exact decimal string with up to 4 places; never a float. */
export const moneyAmount = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,13}(\.\d{1,4})?$/, 'Enter an amount with up to 4 decimal places'));

const featureList = z
  .array(z.string())
  .max(200)
  .refine((list) => list.every(isFeature), 'Unknown feature code')
  .transform((list) => [...new Set(list)].sort());

const limitMap = z
  .record(z.string(), z.number().int().min(0).max(1_000_000_000_000).nullable())
  .refine((m) => Object.keys(m).every(isLimitKey), 'Unknown limit code');

export const createPlanSchema = z.object({
  code: planCode,
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(100),
});
export type CreatePlanInput = z.input<typeof createPlanSchema>;

export const priceSchema = z.object({
  currency,
  billingPeriod: z.enum(['MONTHLY', 'ANNUAL']),
  pricingModel: z.enum(['PER_USER', 'PER_EMPLOYEE', 'FLAT']),
  amount: moneyAmount,
});
export type PriceInput = z.input<typeof priceSchema>;

/** Edits a draft plan version. Prices, when given, replace the draft's prices. */
export const updatePlanVersionSchema = z
  .object({
    features: featureList.optional(),
    limits: limitMap.optional(),
    trialDays: z.coerce.number().int().min(0).max(365).optional(),
    graceDays: z.coerce.number().int().min(0).max(365).optional(),
    supportLevel: z.enum(SUPPORT_LEVELS).optional(),
    deploymentModels: z
      .array(z.enum(DEPLOYMENT_MODELS))
      .min(1, 'Choose at least one deployment model')
      .transform((l) => [...new Set(l)])
      .optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    prices: z
      .array(priceSchema)
      .max(20)
      .refine(
        (prices) => new Set(prices.map((p) => `${p.currency}:${p.billingPeriod}`)).size === prices.length,
        'One price per currency and billing period',
      )
      .optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');
export type UpdatePlanVersionInput = z.input<typeof updatePlanVersionSchema>;

export const createAddonSchema = z.object({
  code: planCode,
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).nullable().optional(),
  kind: z.enum(['FEATURE', 'CAPACITY', 'SERVICE']),
  features: featureList.default([]),
  limits: limitMap.default({}),
  prices: z.array(priceSchema).max(20).default([]),
});
export type CreateAddonInput = z.input<typeof createAddonSchema>;

export const updateAddonSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(300).nullable().optional(),
    features: featureList.optional(),
    limits: limitMap.optional(),
    prices: z.array(priceSchema).max(20).optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');
export type UpdateAddonInput = z.input<typeof updateAddonSchema>;

const isoDate = z.iso.datetime({ offset: true }).transform((v) => new Date(v));

/** Puts an organisation on a plan version: a new subscription, or a plan change. */
export const assignSubscriptionSchema = z
  .object({
    planVersionId: z.uuid(),
    status: z.enum(['TRIAL', 'ACTIVE']),
    billingPeriod: z.enum(['MONTHLY', 'ANNUAL']).default('MONTHLY'),
    currency: currency.default('INR'),
    /** For TRIAL: override the plan's trial length. */
    trialDays: z.coerce.number().int().min(1).max(365).optional(),
    /** For ACTIVE: end of the paid period; omit for open-ended contracts. */
    currentPeriodEnd: isoDate.nullable().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.status !== 'TRIAL' || v.currentPeriodEnd === undefined || v.currentPeriodEnd === null, {
    path: ['currentPeriodEnd'],
    message: 'A trial ends after its trial days, not at a period end',
  });
export type AssignSubscriptionInput = z.input<typeof assignSubscriptionSchema>;

export const subscriptionActionSchema = z.discriminatedUnion('action', [
  /** Payment received: starts a new period from the old end (or now, if lapsed). */
  z.object({
    action: z.literal('renew'),
    currentPeriodEnd: isoDate,
    reason: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal('mark_past_due'),
    graceEndsAt: isoDate,
    reason: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal('suspend'), reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal('reactivate'), reason: z.string().trim().max(500).optional() }),
  /** Stops renewal; access continues until the end of the current period. */
  z.object({ action: z.literal('cancel'), reason: z.string().trim().max(500).optional() }),
]);
export type SubscriptionActionInput = z.input<typeof subscriptionActionSchema>;

export const setSubscriptionAddonSchema = z.object({
  addonId: z.uuid(),
  /** 0 removes the add-on. */
  quantity: z.coerce.number().int().min(0).max(100_000),
});

export const createOverrideSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('FEATURE'),
    key: z.string().refine(isFeature, 'Unknown feature code'),
    enabled: z.boolean(),
    reason: z.string().trim().min(3).max(500),
    expiresAt: isoDate.nullable().optional(),
  }),
  z.object({
    kind: z.literal('LIMIT'),
    key: z.string().refine(isLimitKey, 'Unknown limit code'),
    value: z.number().int().min(0).nullable(),
    reason: z.string().trim().min(3).max(500),
    expiresAt: isoDate.nullable().optional(),
  }),
]);
export type CreateOverrideInput = z.input<typeof createOverrideSchema>;
