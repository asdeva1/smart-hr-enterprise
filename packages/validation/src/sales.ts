import { z } from 'zod';
import { dateOnly } from './employees.js';
import { nameField } from './org.js';

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
const money = z.coerce
  .number()
  .min(0, 'Can’t be negative')
  .max(10_000_000_000, 'Too large')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'At most two decimals');

export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28] as const;
export const SALES_DOC_TYPES = ['INVOICE', 'QUOTATION', 'PROFORMA', 'CHALLAN', 'CREDIT_NOTE'] as const;
export const SALES_DOC_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'] as const;
export const PAYMENT_MODES = ['BANK', 'CASH', 'UPI', 'CARD', 'CHEQUE'] as const;

const gstin = z.preprocess(
  (v) => (typeof v === 'string' ? blankToNull(v.trim().toUpperCase()) : v),
  z
    .string()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter the 15-character GSTIN')
    .nullable()
    .optional(),
);
const pan = z.preprocess(
  (v) => (typeof v === 'string' ? blankToNull(v.trim().toUpperCase()) : v),
  z
    .string()
    .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Enter the 10-character PAN')
    .nullable()
    .optional(),
);
const stateCode = z.preprocess(
  blankToNull,
  z
    .string()
    .regex(/^\d{2}$/, 'Use the two-digit GST state code')
    .nullable()
    .optional(),
);

export const customerSchema = z.object({
  name: nameField,
  gstin,
  pan,
  stateCode,
  contactName: optionalText(120),
  email: z.preprocess(blankToNull, z.email('Enter a valid email').max(254).nullable().optional()),
  phone: optionalText(30),
  billingAddress: optionalText(500),
  shippingAddress: optionalText(500),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(15),
  notes: optionalText(1000),
});
export type CustomerInput = z.input<typeof customerSchema>;

export const updateCustomerSchema = customerSchema
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1d56c9');

export const templateSchema = z.object({
  name: nameField,
  layout: z.enum(['CLASSIC', 'MODERN', 'MINIMAL', 'COMPACT_GST']).default('CLASSIC'),
  accent: hexColour.default('#1d56c9'),
  showHsn: z.boolean().default(true),
  showGstSplit: z.boolean().default(true),
  showBank: z.boolean().default(true),
  showUpi: z.boolean().default(true),
  showSignatory: z.boolean().default(false),
  showPo: z.boolean().default(true),
  defaultTerms: optionalText(1000),
  defaultNote: optionalText(1000),
});
export type TemplateInput = z.input<typeof templateSchema>;

export const updateTemplateSchema = templateSchema
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');

export const salesSettingSchema = z.object({
  gstin,
  pan,
  stateCode,
  address: optionalText(500),
  bankName: optionalText(120),
  bankAccountNo: optionalText(40),
  bankIfsc: z.preprocess(
    (v) => (typeof v === 'string' ? blankToNull(v.trim().toUpperCase()) : v),
    z
      .string()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter the 11-character IFSC')
      .nullable()
      .optional(),
  ),
  upiId: optionalText(80),
  signatory: optionalText(120),
});
export type SalesSettingInput = z.input<typeof salesSettingSchema>;

export const salesLineSchema = z.object({
  description: z.string().trim().min(1, 'Describe the item').max(300),
  hsn: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .regex(/^\d{4,8}$/, 'HSN or SAC is 4 to 8 digits')
      .nullable()
      .optional(),
  ),
  quantity: z.coerce.number().positive('Enter a quantity').max(1_000_000_000),
  unit: optionalText(20),
  rate: money,
  discountPct: z.coerce.number().min(0).max(100).default(0),
  gstRate: z.coerce
    .number()
    .refine((v) => (GST_RATES as readonly number[]).includes(v), 'Choose a GST rate')
    .default(0),
});

export const salesDocumentSchema = z.object({
  companyId: z.uuid('Choose a company'),
  customerId: z.uuid('Choose a customer'),
  type: z.enum(SALES_DOC_TYPES),
  templateId: z.preprocess(blankToNull, z.uuid().nullable().optional()),
  date: dateOnly,
  dueDate: z.preprocess(blankToNull, dateOnly.nullable().optional()),
  poNumber: optionalText(60),
  placeOfSupply: stateCode,
  note: optionalText(1000),
  terms: optionalText(1000),
  relatedId: z.preprocess(blankToNull, z.uuid().nullable().optional()),
  lines: z.array(salesLineSchema).min(1, 'Add at least one item').max(200),
});
export type SalesDocumentInput = z.input<typeof salesDocumentSchema>;

export const updateSalesDocumentSchema = salesDocumentSchema.omit({ companyId: true, type: true });

export const salesDocumentListSchema = z.object({
  companyId: z.uuid(),
  type: z.enum(SALES_DOC_TYPES).default('INVOICE'),
  status: z.enum([...SALES_DOC_STATUSES, 'OPEN', 'OVERDUE', 'ALL']).default('ALL'),
  customerId: z.uuid().optional(),
  q: z.string().trim().max(80).optional(),
});

export const receiptSchema = z.object({
  companyId: z.uuid('Choose a company'),
  customerId: z.uuid('Choose a customer'),
  date: dateOnly,
  amount: money.refine((v) => v > 0, 'Enter the amount received'),
  mode: z.enum(PAYMENT_MODES),
  reference: optionalText(80),
  note: optionalText(300),
  depositAccountId: z.uuid('Choose where the money went'),
  /** Leave out to settle the oldest invoices first. */
  allocations: z
    .array(z.object({ documentId: z.uuid(), amount: money.refine((v) => v > 0) }))
    .max(100)
    .optional(),
});
export type ReceiptInput = z.input<typeof receiptSchema>;

export const salesCompanyQuerySchema = z.object({ companyId: z.uuid() });
export const salesStatementQuerySchema = z.object({ companyId: z.uuid(), from: dateOnly, to: dateOnly });
export const salesAgeingQuerySchema = z.object({ companyId: z.uuid(), asOf: dateOnly.optional() });
