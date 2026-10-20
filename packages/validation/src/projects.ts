import { z } from 'zod';
import { dateOnly } from './employees.js';
import { codeField, nameField } from './org.js';

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
const optionalDate = z.preprocess(blankToNull, dateOnly.nullable()).optional();
const money = z.coerce
  .number()
  .min(0, 'Can’t be negative')
  .max(10_000_000, 'Too large')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'At most two decimals');
const hours = z.preprocess(
  blankToNull,
  z.coerce.number().positive('Enter hours above zero').max(1_000_000).nullable(),
);

export const projectStatusSchema = z.enum(['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED']);

export const projectSchema = z.object({
  companyId: z.uuid('Choose a company'),
  code: codeField,
  name: nameField,
  clientName: optionalText(200),
  billable: z.boolean().default(true),
  hourlyRate: money.default(0),
  budgetHours: hours.optional(),
  startDate: optionalDate,
  endDate: optionalDate,
  managerId: z.preprocess(blankToNull, z.uuid().nullable()).optional(),
  notes: optionalText(2000),
});

export const updateProjectSchema = z
  .object({
    name: nameField.optional(),
    clientName: optionalText(200),
    status: projectStatusSchema.optional(),
    billable: z.boolean().optional(),
    hourlyRate: money.optional(),
    budgetHours: hours.optional(),
    startDate: optionalDate,
    endDate: optionalDate,
    managerId: z.preprocess(blankToNull, z.uuid().nullable()).optional(),
    notes: optionalText(2000),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');

export const projectMembersSchema = z.object({
  members: z
    .array(z.object({ employeeId: z.uuid(), costRate: money.default(0) }))
    .max(500)
    .refine((m) => new Set(m.map((x) => x.employeeId)).size === m.length, 'Each person once'),
});

export const projectListQuerySchema = z.object({
  status: projectStatusSchema.optional(),
});

export const timeEntrySchema = z.object({
  projectId: z.uuid('Choose a project'),
  workDate: dateOnly,
  /** Hours, in quarters or finer: 1.5 means an hour and a half. */
  hours: z.coerce.number().positive('Enter hours above zero').max(24, 'No more than 24 hours in a day'),
  billable: z.boolean().optional(),
  note: optionalText(500),
});

export const updateTimeEntrySchema = z
  .object({
    hours: z.coerce.number().positive().max(24).optional(),
    billable: z.boolean().optional(),
    note: optionalText(500),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');

export const timeRangeSchema = z.object({
  from: dateOnly,
  to: dateOnly,
});

export const approveTimeSchema = z.object({
  projectId: z.uuid(),
  from: dateOnly,
  to: dateOnly,
  employeeId: z.uuid().optional(),
});

export const employeeSearchSchema = z.object({ search: z.string().trim().max(100).default('') });
