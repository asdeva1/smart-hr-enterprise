import { z } from 'zod';
import { codeField, nameField } from './org.js';
import { dateOnly } from './employees.js';

/** Whole or half days, e.g. 12 or 1.5. */
export const halfDays = (label: string, max = 365) =>
  z.coerce
    .number()
    .min(0, `${label} can’t be negative`)
    .max(max, `${label} is too large`)
    .refine((v) => Number.isInteger(v * 2), `${label} must be whole or half days`);

const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(max).nullable().optional(),
  );

// ---- Holidays -------------------------------------------------------------------------------------

/** Where a calendar applies: the whole organisation, one company or one branch. */
export const calendarPlaceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TENANT') }),
  z.object({ type: z.literal('COMPANY'), id: z.uuid('Choose a company') }),
  z.object({ type: z.literal('BRANCH'), id: z.uuid('Choose a branch') }),
]);

export const createHolidayCalendarSchema = z.object({
  name: nameField,
  place: calendarPlaceSchema,
  /** Copy this year's holidays from another calendar (optional). */
  copyFrom: z.object({ calendarId: z.uuid(), year: z.number().int().min(2000).max(2100) }).optional(),
});
export type CreateHolidayCalendarInput = z.input<typeof createHolidayCalendarSchema>;

export const updateHolidayCalendarSchema = z
  .object({ name: nameField.optional(), status: z.enum(['ACTIVE', 'ARCHIVED']).optional() })
  .refine((v) => v.name !== undefined || v.status !== undefined, 'Nothing to change');

export const holidaySchema = z.object({
  date: dateOnly,
  name: z.string().trim().min(2, 'Use at least 2 characters').max(100, 'Name is too long'),
  optional: z.boolean().default(false),
});
export type HolidayInput = z.input<typeof holidaySchema>;

export const updateHolidaySchema = holidaySchema.omit({ date: true }).partial();

export const yearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});

// ---- Leave types ----------------------------------------------------------------------------------

const leaveTypeFields = z.object({
  code: codeField,
  name: nameField,
  description: optionalText(500),
  paid: z.boolean().default(true),
  accrual: z.enum(['YEARLY', 'MONTHLY', 'NONE']).default('YEARLY'),
  quotaDays: halfDays('Days per year').default(0),
  carryForwardMaxDays: halfDays('Carry forward').default(0),
  allowHalfDay: z.boolean().default(true),
  includeNonWorkingDays: z.boolean().default(false),
  minNoticeDays: z.coerce.number().int().min(0, 'Notice can’t be negative').max(365).default(0),
  maxDaysPerRequest: z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.coerce.number().int().min(1, 'Use at least 1 day').max(365).nullable(),
  ),
});

function checkLeaveType(
  v: { accrual?: string; quotaDays?: number; carryForwardMaxDays?: number },
  ctx: z.RefinementCtx,
) {
  if (v.accrual === 'NONE' && (v.quotaDays ?? 0) > 0) {
    ctx.addIssue({ code: 'custom', path: ['quotaDays'], message: 'A type without a balance has no quota' });
  }
  if (v.accrual !== 'NONE' && v.accrual !== undefined && (v.quotaDays ?? 0) === 0) {
    ctx.addIssue({ code: 'custom', path: ['quotaDays'], message: 'Set the days per year' });
  }
  if (v.accrual === 'NONE' && (v.carryForwardMaxDays ?? 0) > 0) {
    ctx.addIssue({ code: 'custom', path: ['carryForwardMaxDays'], message: 'Nothing to carry forward' });
  }
}

export const createLeaveTypeSchema = leaveTypeFields.superRefine(checkLeaveType);
export type CreateLeaveTypeInput = z.input<typeof createLeaveTypeSchema>;

export const updateLeaveTypeSchema = leaveTypeFields
  .omit({ code: true })
  .extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() })
  .superRefine(checkLeaveType);
export type UpdateLeaveTypeInput = z.input<typeof updateLeaveTypeSchema>;

// ---- Requests -------------------------------------------------------------------------------------

export const leaveRequestSchema = z
  .object({
    /** Someone else's record, for people with leave.manage. Omit to apply for yourself. */
    employeeId: z.uuid().optional(),
    leaveTypeId: z.uuid('Choose a leave type'),
    from: dateOnly,
    to: dateOnly,
    halfDay: z.preprocess(
      (v) => (v === '' ? null : v),
      z.enum(['FIRST_HALF', 'SECOND_HALF']).nullable().optional(),
    ),
    reason: z.string().trim().min(3, 'Say briefly why').max(500, 'Keep it under 500 characters'),
  })
  .superRefine((v, ctx) => {
    if (v.to < v.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Ends before it starts' });
    if (v.halfDay && v.to !== v.from) {
      ctx.addIssue({ code: 'custom', path: ['halfDay'], message: 'A half day must be a single day' });
    }
    if (v.from.slice(0, 4) !== v.to.slice(0, 4)) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'Split leave that crosses into a new year into two requests',
      });
    }
  });
export type LeaveRequestInput = z.input<typeof leaveRequestSchema>;

/** Previews how many days a request would use, without creating it. */
export const leavePreviewSchema = z.object({
  employeeId: z.uuid().optional(),
  leaveTypeId: z.uuid(),
  from: dateOnly,
  to: dateOnly,
  halfDay: z.enum(['FIRST_HALF', 'SECOND_HALF']).optional(),
});

export const leaveCancelSchema = z.object({ reason: optionalText(500) });

export const leaveListQuerySchema = z.object({
  scope: z.enum(['mine', 'team']).default('mine'),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED']).optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});

export const leaveCalendarQuerySchema = z.object({
  from: dateOnly,
  to: dateOnly,
  companyId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
});

// ---- Balances -------------------------------------------------------------------------------------

export const balanceQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const balanceAdjustmentSchema = z.object({
  employeeId: z.uuid('Choose an employee'),
  leaveTypeId: z.uuid('Choose a leave type'),
  year: z.number().int().min(2000).max(2100),
  /** Positive adds days, negative takes them away. */
  days: z.coerce
    .number()
    .min(-365)
    .max(365)
    .refine((v) => v !== 0, 'Use a positive or negative number of days')
    .refine((v) => Number.isInteger(v * 2), 'Use whole or half days'),
  note: z.string().trim().min(3, 'Say why, for the record').max(500),
});
export type BalanceAdjustmentInput = z.input<typeof balanceAdjustmentSchema>;

export const allocationSchema = z.object({ year: z.number().int().min(2000).max(2100) });
