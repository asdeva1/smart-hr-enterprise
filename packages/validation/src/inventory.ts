import { z } from 'zod';
import { dateOnly } from './employees.js';
import { codeField, nameField } from './org.js';

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());

const qty = z.coerce
  .number()
  .max(1_000_000_000, 'Too large')
  .refine((v) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6, 'At most three decimals');
const positiveQty = qty.refine((v) => v > 0, 'Enter a quantity above zero');
const money = z.coerce
  .number()
  .min(0, 'Can’t be negative')
  .max(10_000_000_000, 'Too large')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'At most two decimals');

export const warehouseSchema = z.object({
  companyId: z.uuid('Choose a company'),
  code: codeField,
  name: nameField,
  address: optionalText(500),
});

export const updateWarehouseSchema = z
  .object({
    name: nameField.optional(),
    address: optionalText(500),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');

export const skuField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9A-Z][0-9A-Z./-]{1,29}$/, 'Use 2–30 capital letters, digits, dots, slashes or hyphens');

export const inventoryItemSchema = z.object({
  sku: skuField,
  name: nameField,
  unit: z.string().trim().min(1, 'Enter the unit').max(20),
  category: optionalText(60),
  reorderLevel: z.preprocess(blankToNull, qty.min(0).nullable().optional()),
  standardCost: money.default(0),
  notes: optionalText(500),
});

export const updateInventoryItemSchema = z
  .object({
    name: nameField.optional(),
    unit: z.string().trim().min(1).max(20).optional(),
    category: optionalText(60),
    reorderLevel: z.preprocess(blankToNull, qty.min(0).nullable().optional()),
    standardCost: money.optional(),
    notes: optionalText(500),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');

export const stockQuerySchema = z.object({
  warehouseId: z.uuid().optional(),
  itemId: z.uuid().optional(),
  lowOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const movementQuerySchema = z.object({
  warehouseId: z.uuid().optional(),
  itemId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const movementBase = {
  itemId: z.uuid('Choose an item'),
  occurredOn: dateOnly.optional(),
  reference: optionalText(100),
  note: optionalText(300),
};

export const stockReceiptSchema = z.object({
  ...movementBase,
  warehouseId: z.uuid('Choose a warehouse'),
  quantity: positiveQty,
  unitCost: z.preprocess(blankToNull, money.nullable().optional()),
});

export const stockIssueSchema = z.object({
  ...movementBase,
  warehouseId: z.uuid('Choose a warehouse'),
  quantity: positiveQty,
});

export const stockAdjustmentSchema = z.object({
  ...movementBase,
  warehouseId: z.uuid('Choose a warehouse'),
  /** Plus to add, minus to remove, e.g. after a stock count. */
  quantity: qty.refine((v) => v !== 0, 'Enter a quantity other than zero'),
  note: z.string().trim().min(3, 'Say why the stock is being adjusted').max(300),
});

export const stockTransferSchema = z
  .object({
    ...movementBase,
    fromWarehouseId: z.uuid('Choose where it comes from'),
    toWarehouseId: z.uuid('Choose where it goes'),
    quantity: positiveQty,
  })
  .refine((v) => v.fromWarehouseId !== v.toWarehouseId, {
    path: ['toWarehouseId'],
    message: 'Choose a different warehouse',
  });
