import { z } from 'zod';
import { dateOnly } from './employees.js';
import { nameField } from './org.js';

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());

const cost = z.coerce
  .number()
  .min(0, 'Can’t be negative')
  .max(10_000_000_000, 'Too large')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'At most two decimals');

export const assetTagField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9A-Z][0-9A-Z./-]{1,29}$/, 'Use 2–30 capital letters, digits, dots, slashes or hyphens');

export const assetSchema = z
  .object({
    companyId: z.uuid('Choose a company'),
    tag: assetTagField,
    name: nameField,
    category: z.string().trim().min(2, 'Enter a category').max(60),
    serialNumber: optionalText(100),
    vendorId: z.preprocess(blankToNull, z.uuid().nullable().optional()),
    purchaseDate: dateOnly,
    purchaseCost: cost,
    salvageValue: cost.default(0),
    usefulLifeMonths: z.coerce.number().int().min(1, 'At least a month').max(600),
    notes: optionalText(1000),
  })
  .refine((v) => v.salvageValue <= v.purchaseCost, {
    path: ['salvageValue'],
    message: 'The resale value can’t be more than the cost',
  });
export type AssetInput = z.input<typeof assetSchema>;

export const updateAssetSchema = z
  .object({
    name: nameField.optional(),
    category: z.string().trim().min(2).max(60).optional(),
    serialNumber: optionalText(100),
    notes: optionalText(1000),
    /** Move between in stock and under repair; assigning and retiring have their own actions. */
    status: z.enum(['IN_STOCK', 'UNDER_REPAIR']).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');

export const assetListQuerySchema = z.object({
  companyId: z.uuid().optional(),
  status: z.enum(['IN_STOCK', 'ASSIGNED', 'UNDER_REPAIR', 'RETIRED']).optional(),
  q: z.string().trim().max(100).optional(),
});

export const assignAssetSchema = z.object({
  employeeId: z.uuid('Choose an employee'),
  assignedOn: dateOnly.optional(),
  condition: optionalText(200),
});

export const returnAssetSchema = z.object({
  returnedOn: dateOnly.optional(),
  condition: optionalText(200),
  /** Needs repair before it can be given out again. */
  needsRepair: z.boolean().default(false),
});

export const retireAssetSchema = z.object({
  retiredOn: dateOnly.optional(),
  reason: z.string().trim().min(3, 'Say why it is being retired').max(300),
});
