import { z } from 'zod';
import { dateOnly } from './employees.js';
import { GST_RATES, PAYMENT_MODES } from './sales.js';

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
const money = z.coerce
  .number()
  .min(0, 'Can’t be negative')
  .max(10_000_000_000, 'Too large')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'At most two decimals');

export const BILL_TYPES = ['BILL', 'DEBIT_NOTE'] as const;
export const BILL_STATUSES = ['DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'] as const;
/** Common TDS rates on payments to vendors (sections 194C, 194J, 194H, 194I and so on). */
export const TDS_RATES = [0, 1, 2, 5, 10, 20] as const;

export const billLineSchema = z.object({
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
  rate: money,
  gstRate: z.coerce
    .number()
    .refine((v) => (GST_RATES as readonly number[]).includes(v), 'Choose a GST rate')
    .default(0),
  accountId: z.uuid('Choose the account this is booked to'),
});

export const billSchema = z.object({
  companyId: z.uuid('Choose a company'),
  vendorId: z.uuid('Choose a vendor'),
  type: z.enum(BILL_TYPES).default('BILL'),
  vendorBillNo: optionalText(60),
  date: dateOnly,
  dueDate: z.preprocess(blankToNull, dateOnly.nullable().optional()),
  placeOfSupply: z.preprocess(
    blankToNull,
    z
      .string()
      .regex(/^\d{2}$/)
      .nullable()
      .optional(),
  ),
  note: optionalText(1000),
  tdsRate: z.coerce.number().min(0).max(30).default(0),
  relatedId: z.preprocess(blankToNull, z.uuid().nullable().optional()),
  lines: z.array(billLineSchema).min(1, 'Add at least one item').max(200),
});
export type BillInput = z.input<typeof billSchema>;

export const updateBillSchema = billSchema.omit({ companyId: true, type: true });

export const billListSchema = z.object({
  companyId: z.uuid(),
  type: z.enum(BILL_TYPES).default('BILL'),
  status: z.enum([...BILL_STATUSES, 'OPEN', 'OVERDUE', 'ALL']).default('ALL'),
  vendorId: z.uuid().optional(),
  q: z.string().trim().max(80).optional(),
});

export const vendorPaymentSchema = z.object({
  companyId: z.uuid('Choose a company'),
  vendorId: z.uuid('Choose a vendor'),
  date: dateOnly,
  amount: money.refine((v) => v > 0, 'Enter the amount paid'),
  mode: z.enum(PAYMENT_MODES),
  reference: optionalText(80),
  note: optionalText(300),
  paidFromAccountId: z.uuid('Choose where the money came from'),
  /** Leave out to settle the oldest bills first. */
  allocations: z
    .array(z.object({ billId: z.uuid(), amount: money.refine((v) => v > 0) }))
    .max(100)
    .optional(),
});
export type VendorPaymentInput = z.input<typeof vendorPaymentSchema>;

export const payablesAgeingQuerySchema = z.object({ companyId: z.uuid(), asOf: dateOnly.optional() });
