import { z } from 'zod';
import { dateOnly } from './employees.js';

const money = z.coerce
  .number()
  .min(0, 'Can’t be negative')
  .max(10_000_000_000, 'Too large')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'At most two decimals');
const signedMoney = z.coerce
  .number()
  .min(-10_000_000_000)
  .max(10_000_000_000)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'At most two decimals');

export const bankStatementLineSchema = z
  .object({
    date: dateOnly,
    description: z.string().trim().min(1, 'Add a description').max(500),
    reference: z.string().trim().max(200).nullish(),
    deposit: money.default(0),
    withdrawal: money.default(0),
    balance: signedMoney.nullish(),
  })
  .refine((l) => l.deposit > 0 !== l.withdrawal > 0, {
    message: 'A line is either a deposit or a withdrawal, with an amount',
    path: ['deposit'],
  });

export const bankImportSchema = z.object({
  companyId: z.uuid('Choose a company'),
  accountId: z.uuid('Choose the bank account'),
  fileName: z.string().trim().min(1).max(200),
  openingBalance: signedMoney.nullish(),
  closingBalance: signedMoney.nullish(),
  lines: z
    .array(bankStatementLineSchema)
    .min(1, 'The statement has no lines')
    .max(5000, 'At most 5,000 lines'),
});
export type BankImportInput = z.input<typeof bankImportSchema>;

export const bankAccountQuerySchema = z.object({ companyId: z.uuid(), accountId: z.uuid() });
export const bankLinesQuerySchema = bankAccountQuerySchema.extend({
  status: z.enum(['UNMATCHED', 'MATCHED', 'IGNORED']).optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});
export const bankMatchSchema = z.object({ journalLineId: z.uuid() });
export const bankIgnoreSchema = z.object({ note: z.string().trim().max(300).nullish() });
export const bankSummaryQuerySchema = bankAccountQuerySchema.extend({ asOf: dateOnly.optional() });
