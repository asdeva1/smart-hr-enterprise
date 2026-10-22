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
