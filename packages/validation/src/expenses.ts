import { z } from 'zod';
import { dateOnly } from './employees.js';
import { codeField, nameField } from './org.js';

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());

const money = z.coerce
  .number()
  .positive('Enter an amount above zero')
  .max(10_000_000_000, 'Too large')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'At most two decimals');

// ---- Vendors -----------------------------------------------------------------------------------------

const gstin = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim().toUpperCase()) : v),
  z
    .string()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN')
    .nullable()
    .optional(),
);
const pan = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim().toUpperCase()) : v),
  z
    .string()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Enter a valid 10-character PAN')
    .nullable()
    .optional(),
);

export const vendorSchema = z.object({
  code: codeField,
  name: nameField,
  gstin,
  pan,
  contactName: optionalText(200),
  email: z.preprocess(blankToNull, z.email('Enter a valid email').nullable().optional()),
  phone: optionalText(40),
  address: optionalText(500),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
  notes: optionalText(1000),
});
export type VendorInput = z.input<typeof vendorSchema>;

export const updateVendorSchema = z
  .object({
    name: nameField.optional(),
    gstin,
    pan,
    contactName: optionalText(200),
    email: vendorSchema.shape.email,
    phone: optionalText(40),
    address: optionalText(500),
    paymentTermsDays: z.coerce.number().int().min(0).max(365).optional(),
    notes: optionalText(1000),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');

export const vendorListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});

// ---- Expense categories --------------------------------------------------------------------------------

export const expenseCategorySchema = z.object({
  code: codeField,
  name: nameField,
  requiresReceipt: z.boolean().default(false),
  maxAmount: z.preprocess(blankToNull, money.nullable().optional()),
});
export type ExpenseCategoryInput = z.input<typeof expenseCategorySchema>;

export const updateExpenseCategorySchema = z
  .object({
    name: nameField.optional(),
    requiresReceipt: z.boolean().optional(),
    maxAmount: z.preprocess(blankToNull, money.nullable().optional()),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');

// ---- Claims --------------------------------------------------------------------------------------------

export const expenseLineSchema = z.object({
  date: dateOnly,
  categoryId: z.uuid('Choose a category'),
  description: z.string().trim().min(2, 'Say what it was for').max(300),
  amount: money,
  receiptNumber: optionalText(100),
});

export const expenseClaimSchema = z.object({
  /** Claim for someone else (needs expenses.manage where they sit); omitted = for yourself. */
  employeeId: z.uuid().optional(),
  title: z.string().trim().min(3, 'Give the claim a title').max(200),
  lines: z.array(expenseLineSchema).min(1, 'Add at least one expense').max(100),
});
export type ExpenseClaimInput = z.input<typeof expenseClaimSchema>;

export const updateExpenseClaimSchema = z.object({
  title: expenseClaimSchema.shape.title,
  lines: expenseClaimSchema.shape.lines,
});

export const expenseListQuerySchema = z.object({
  status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED']).optional(),
  scope: z.enum(['mine', 'all']).default('mine'),
});

export const payExpenseClaimSchema = z.object({
  reference: z.string().trim().min(2, 'Enter the payment reference').max(100),
});
