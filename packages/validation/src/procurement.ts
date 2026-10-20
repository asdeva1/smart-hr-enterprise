import { z } from 'zod';
import { dateOnly } from './employees.js';

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());

const quantity = z.coerce
  .number()
  .positive('Enter a quantity above zero')
  .max(1_000_000, 'Too large')
  .refine((v) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6, 'At most three decimals');

const price = z.coerce
  .number()
  .min(0, 'Can’t be negative')
  .max(10_000_000_000, 'Too large')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'At most two decimals');

const description = z.string().trim().min(2, 'Say what it is').max(300);

export const purchaseRequestSchema = z.object({
  title: z.string().trim().min(3, 'Give the request a title').max(200),
  justification: optionalText(1000),
  lines: z
    .array(z.object({ description, quantity, estimatedUnitPrice: price }))
    .min(1, 'Add at least one item')
    .max(100),
});
export type PurchaseRequestInput = z.input<typeof purchaseRequestSchema>;

export const purchaseRequestListQuerySchema = z.object({
  status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'ORDERED']).optional(),
  scope: z.enum(['mine', 'all']).default('mine'),
});

export const purchaseOrderSchema = z.object({
  companyId: z.uuid('Choose a company'),
  vendorId: z.uuid('Choose a vendor'),
  requestId: z.uuid().nullable().optional(),
  orderDate: dateOnly,
  expectedDate: z.preprocess(blankToNull, dateOnly.nullable().optional()),
  terms: optionalText(1000),
  lines: z
    .array(
      z.object({
        description,
        quantity,
        unitPrice: price,
        taxRate: z.coerce.number().min(0).max(100).default(0),
      }),
    )
    .min(1, 'Add at least one item')
    .max(200),
});
export type PurchaseOrderInput = z.input<typeof purchaseOrderSchema>;

export const updatePurchaseOrderSchema = purchaseOrderSchema.omit({ companyId: true, requestId: true });

export const purchaseOrderListQuerySchema = z.object({
  companyId: z.uuid().optional(),
  vendorId: z.uuid().optional(),
  status: z
    .enum([
      'DRAFT',
      'PENDING_APPROVAL',
      'APPROVED',
      'PARTIALLY_RECEIVED',
      'RECEIVED',
      'REJECTED',
      'CANCELLED',
    ])
    .optional(),
});

export const receiveGoodsSchema = z.object({
  receivedOn: dateOnly,
  note: optionalText(500),
  lines: z
    .array(z.object({ orderLineId: z.uuid(), quantity }))
    .min(1, 'Enter what arrived')
    .max(200),
});
