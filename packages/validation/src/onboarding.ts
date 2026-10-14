import { z } from 'zod';
import { assignSubscriptionSchema } from './plans.js';

const email = z
  .email('Enter a valid email address')
  .trim()
  .max(254)
  .transform((v) => v.toLowerCase());

export const tenantSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9-]{1,62}$/,
    'Use 2–63 lower-case letters, digits or -, starting with a letter or digit',
  );

const organisationName = z.string().trim().min(2, 'Use at least 2 characters').max(200);
const personName = z.string().trim().min(1, 'Enter a name').max(200);

/** Creates an organisation with its first owner, who receives an invitation to set a password. */
export const provisionTenantSchema = z.object({
  name: organisationName,
  slug: tenantSlug,
  ownerEmail: email,
  ownerName: personName,
  /** Optional: start a subscription straight away. */
  subscription: assignSubscriptionSchema.optional(),
});
export type ProvisionTenantInput = z.input<typeof provisionTenantSchema>;

export const tenantLifecycleSchema = z.discriminatedUnion('action', [
  /** Blocks all access (e.g. abuse or a legal hold). Data stays. */
  z.object({ action: z.literal('suspend'), reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal('reactivate'), reason: z.string().trim().max(500).optional() }),
  /** Members keep read-only access and can export their data; nothing can be changed. */
  z.object({ action: z.literal('start_offboarding'), reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal('cancel_offboarding'), reason: z.string().trim().max(500).optional() }),
  /** Ends all access after offboarding. Data is retained, not deleted; typing the slug confirms. */
  z.object({
    action: z.literal('archive'),
    reason: z.string().trim().min(3).max(500),
    confirmSlug: z.string().trim(),
  }),
  z.object({ action: z.literal('rename'), name: organisationName }),
]);
export type TenantLifecycleInput = z.input<typeof tenantLifecycleSchema>;

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG contrast ratio of a #RRGGBB colour against white. */
export function contrastWithWhite(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const lum =
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  return 1.05 / (lum + 0.05);
}

const nullableText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(max).nullable(),
  );

export const brandingSchema = z.object({
  brandName: nullableText(60),
  /** Used behind white text, so it must keep a 4.5:1 contrast ratio (WCAG AA). */
  brandColor: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^#[0-9a-f]{6}$/, 'Use a hex colour such as #0e6b66')
      .refine(
        (hex) => contrastWithWhite(hex) >= 4.5,
        'This colour is too light for white text. Choose a darker shade.',
      )
      .nullable(),
  ),
  brandLogoUrl: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z
      .url({ protocol: /^https$/, message: 'Use an https:// address' })
      .max(500)
      .nullable(),
  ),
});
export type BrandingInput = z.input<typeof brandingSchema>;

/** Self-service sign-up: nothing is created until the emailed link is opened. */
export const signupSchema = z.object({
  organisationName,
  displayName: personName,
  email,
});
export type SignupInput = z.input<typeof signupSchema>;

export const completeSignupSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(1, 'Choose a password').max(256),
});
export type CompleteSignupInput = z.input<typeof completeSignupSchema>;

export const grantOperatorSchema = z.object({ email });
