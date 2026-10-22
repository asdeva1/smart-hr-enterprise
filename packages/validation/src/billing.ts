import { z } from 'zod';
import { emailField } from './auth.js';

const text = (max: number, message: string) => z.string().trim().min(1, message).max(max);

/** Buying a plan from the website. Nothing is created until the payment is confirmed. */
export const checkoutSchema = z.object({
  planCode: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'Choose a plan'),
  billingPeriod: z.enum(['MONTHLY', 'ANNUAL']),
  /** Members or employees for per-unit pricing; ignored for flat prices. */
  quantity: z.coerce.number().int().min(1).max(100_000).default(1),
  organisationName: text(120, 'Enter your organisation’s name'),
  displayName: text(120, 'Enter your name'),
  email: emailField,
});
export type CheckoutInput = z.input<typeof checkoutSchema>;

/** What the payment window hands back to the browser after a successful payment. */
export const confirmCheckoutSchema = z.object({
  orderId: z.uuid(),
  paymentId: z.string().trim().min(5).max(100),
  signature: z.string().trim().min(10).max(200),
});
export type ConfirmCheckoutInput = z.input<typeof confirmCheckoutSchema>;

/** "Talk to us" on the website. Reaches the sales inbox; nothing is created. */
export const contactSalesSchema = z.object({
  name: text(120, 'Enter your name'),
  email: emailField,
  company: text(120, 'Enter your company name'),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[0-9+()\-\s]*$/, 'Use digits, spaces and + ( ) - only')
    .optional(),
  employees: z.coerce.number().int().min(1).max(1_000_000).optional(),
  interest: z.enum(['PRICING', 'DEMO', 'DEDICATED', 'OTHER']).default('PRICING'),
  message: z.string().trim().max(2000).optional(),
});
export type ContactSalesInput = z.input<typeof contactSalesSchema>;
