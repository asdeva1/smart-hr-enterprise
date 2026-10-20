import { z } from 'zod';
import { dateOnly } from './employees.js';
import { nameField } from './org.js';

export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;

const amount = z.coerce
  .number()
  .min(0, 'Can’t be negative')
  .max(10_000_000_000, 'Too large')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'At most two decimals');

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

export const ledgerAccountSchema = z.object({
  companyId: z.uuid('Choose a company'),
  code: z
    .string()
    .trim()
    .regex(/^[0-9A-Z][0-9A-Z.-]{0,19}$/, 'Use up to 20 digits, capital letters, dots or hyphens'),
  name: nameField,
  type: z.enum(ACCOUNT_TYPES),
  description: z.preprocess(blankToNull, z.string().trim().max(500).nullable().optional()),
});
export type LedgerAccountInput = z.input<typeof ledgerAccountSchema>;

export const updateLedgerAccountSchema = z
  .object({
    code: ledgerAccountSchema.shape.code.optional(),
    name: nameField.optional(),
    description: ledgerAccountSchema.shape.description,
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');

export const journalSchema = z.object({
  companyId: z.uuid('Choose a company'),
  date: dateOnly,
  narration: z.string().trim().min(3, 'Say what this is for').max(500),
  lines: z
    .array(
      z.object({
        accountId: z.uuid('Choose an account'),
        debit: amount.default(0),
        credit: amount.default(0),
        narration: z.preprocess(blankToNull, z.string().trim().max(300).nullable().optional()),
      }),
    )
    .min(2, 'A journal needs at least two lines')
    .max(200),
});
export type JournalInput = z.input<typeof journalSchema>;

export const updateJournalSchema = journalSchema.omit({ companyId: true });

export const reverseJournalSchema = z.object({
  date: dateOnly,
  narration: z.preprocess(blankToNull, z.string().trim().min(3).max(500).nullable().optional()),
});

export const journalListQuerySchema = z.object({
  companyId: z.uuid(),
  status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'POSTED', 'CANCELLED', 'ALL']).default('ALL'),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});

export const reportQuerySchema = z.object({
  companyId: z.uuid(),
  from: dateOnly.optional(),
  to: dateOnly,
});

export const ledgerQuerySchema = z.object({
  from: dateOnly,
  to: dateOnly,
});

export const bookLockSchema = z.object({
  /** Close the books up to and including this date; null reopens them fully. */
  lockedUntil: dateOnly.nullable(),
});
