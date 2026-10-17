import { z } from 'zod';
import { dateOnly } from './employees.js';
import { nameField } from './org.js';

const money = (label: string) =>
  z.coerce
    .number()
    .min(0, `${label} can’t be negative`)
    .max(100_000_000, `${label} is too large`)
    .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, `${label} can have at most two decimals`);

export const payComponentSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,19}$/, 'Use 2–20 capital letters, digits or _'),
  name: nameField,
  kind: z.enum(['EARNING', 'DEDUCTION']),
  taxable: z.boolean().default(true),
  pfWage: z.boolean().default(false),
  esiWage: z.boolean().default(true),
  prorate: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
});
export type PayComponentInput = z.input<typeof payComponentSchema>;

export const updatePayComponentSchema = payComponentSchema
  .omit({ code: true, kind: true })
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');

export const salarySchema = z.object({
  effectiveFrom: dateOnly,
  annualCtc: money('Annual CTC'),
  lines: z
    .array(z.object({ componentId: z.uuid(), monthly: money('Amount') }))
    .min(1, 'Add at least one pay component')
    .max(40)
    .refine((l) => new Set(l.map((x) => x.componentId)).size === l.length, 'Each component once'),
  note: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(500).nullable().optional(),
  ),
});
export type SalaryInput = z.input<typeof salarySchema>;

export const INDIAN_STATES = /^[A-Z]{2}$/;

export const employeePayrollSchema = z.object({
  pfEnabled: z.boolean(),
  pfOnFullWages: z.boolean().default(false),
  esiEnabled: z.boolean(),
  ptState: z.preprocess(
    (v) => (v === '' ? null : v),
    z.string().regex(INDIAN_STATES, 'Use the two-letter state code').nullable(),
  ),
});

export const payrollSettingSchema = z.object({
  pfEnabled: z.boolean(),
  esiEnabled: z.boolean(),
  labourCodeWages: z.boolean(),
  pfEstablishmentId: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(30).nullable()),
  esiEmployerCode: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(30).nullable()),
  tan: z.preprocess(
    (v) => (v === '' ? null : typeof v === 'string' ? v.trim().toUpperCase() : v),
    z
      .string()
      .regex(/^[A-Z]{4}\d{5}[A-Z]$/, 'A TAN looks like ABCD12345E')
      .nullable(),
  ),
});

export const professionalTaxSchema = z.object({
  name: nameField,
  slabs: z
    .array(
      z.object({
        upTo: z.number().int().positive().nullable(),
        amount: z.number().int().min(0).max(2500),
        february: z.number().int().min(0).max(2500).optional(),
      }),
    )
    .min(1)
    .max(20)
    .refine((s) => s[s.length - 1]?.upTo === null, 'The last slab must have no upper limit')
    .refine(
      (s) =>
        s.slice(0, -1).every((x, i, a) => x.upTo !== null && (i === 0 || x.upTo > (a[i - 1]!.upTo ?? 0))),
      'Slabs must go up in order',
    ),
});

export const payrollRunSchema = z.object({
  companyId: z.uuid('Choose a company'),
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export const payslipInputSchema = z.object({
  /** Loss-of-pay days entered by hand; null goes back to what attendance says. */
  lopOverride: z.coerce
    .number()
    .min(0)
    .max(31)
    .refine((v) => Number.isInteger(v * 2), 'Whole or half days')
    .nullable()
    .optional(),
  adjustments: z
    .array(
      z.object({
        name: z.string().trim().min(2, 'Name it').max(100),
        kind: z.enum(['EARNING', 'DEDUCTION']),
        amount: money('Amount').refine((v) => v > 0, 'Must be more than zero'),
        taxable: z.boolean().default(true),
      }),
    )
    .max(20)
    .optional(),
});

export const payrollListQuerySchema = z.object({
  companyId: z.uuid().optional(),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
});
