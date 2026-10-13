import { z } from 'zod';

export const lookupCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,29}$/, 'Use up to 30 letters, digits, - or _');

const optionalText = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().max(500).nullable().optional(),
);

export const createLookupValueSchema = z.object({
  code: lookupCode,
  name: z.string().trim().min(2, 'Use at least 2 characters').max(100),
  description: optionalText,
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});
export type CreateLookupValueInput = z.input<typeof createLookupValueSchema>;

/** Code is the value's identity and never changes; archive and re-create instead. */
export const updateLookupValueSchema = z
  .object({
    name: z.string().trim().min(2, 'Use at least 2 characters').max(100).optional(),
    description: optionalText,
    sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');
export type UpdateLookupValueInput = z.input<typeof updateLookupValueSchema>;

export const lookupListQuerySchema = z.object({ includeArchived: z.stringbool().default(false) });
