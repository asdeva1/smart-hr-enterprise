import { z } from 'zod';
import { codeField, nameField } from './org.js';
import { dateOnly } from './employees.js';

/** A time of day as HH:MM (24-hour), stored as minutes after midnight. */
export const timeOfDay = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time like 09:30')
  .transform((v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5)));

/** Minutes after midnight back to HH:MM. */
export function formatMinutes(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const minutes = (max: number, label: string) =>
  z.coerce.number().int(`${label} must be whole minutes`).min(0, `${label} can’t be negative`).max(max);

const shiftFields = z.object({
  code: codeField,
  name: nameField,
  start: timeOfDay,
  end: timeOfDay,
  breakMinutes: minutes(240, 'Break').default(60),
  graceMinutes: minutes(120, 'Grace').default(10),
  halfDayMinutes: minutes(1440, 'Half day').default(240),
  fullDayMinutes: minutes(1440, 'Full day').default(480),
  /** Days off each week: 0 = Sunday … 6 = Saturday. */
  weeklyOffs: z
    .array(z.number().int().min(0).max(6))
    .max(6, 'At least one day a week must be a working day')
    .default([0])
    .transform((days) => [...new Set(days)].sort()),
  isDefault: z.boolean().default(false),
});

type ShiftValues = Pick<z.output<typeof shiftFields>, 'start' | 'end' | 'halfDayMinutes' | 'fullDayMinutes'>;

function checkShift(s: ShiftValues, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (s.start === s.end) issue('end', 'Start and end must be different');
  if (s.halfDayMinutes <= 0) issue('halfDayMinutes', 'A half day needs some minutes');
  if (s.fullDayMinutes < s.halfDayMinutes)
    issue('fullDayMinutes', 'A full day can’t be shorter than a half day');
  else if (s.start !== s.end && s.fullDayMinutes > shiftLength(s.start, s.end)) {
    issue('fullDayMinutes', 'A full day can’t be longer than the shift');
  }
}

/** Length of a shift in minutes; an end before the start crosses midnight. */
export function shiftLength(start: number, end: number): number {
  return end > start ? end - start : end + 1440 - start;
}

export const createShiftSchema = shiftFields.superRefine(checkShift);
export type CreateShiftInput = z.input<typeof createShiftSchema>;

export const updateShiftSchema = shiftFields
  .omit({ code: true })
  .extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() })
  .superRefine(checkShift);
export type UpdateShiftInput = z.input<typeof updateShiftSchema>;

export const assignShiftSchema = z
  .object({
    shiftId: z.uuid('Choose a shift'),
    effectiveFrom: dateOnly,
    /** Specific employees, or everyone currently placed in a company, branch or department. */
    employeeIds: z.array(z.uuid()).max(500).optional(),
    scope: z.object({ type: z.enum(['COMPANY', 'BRANCH', 'DEPARTMENT']), id: z.uuid() }).optional(),
  })
  .refine((v) => (v.employeeIds?.length ?? 0) > 0 || !!v.scope, {
    path: ['employeeIds'],
    message: 'Choose employees or a part of the organisation',
  });
export type AssignShiftInput = z.input<typeof assignShiftSchema>;

export const punchSchema = z.object({ direction: z.enum(['IN', 'OUT']) });

export const adminPunchSchema = z.object({
  employeeId: z.uuid('Choose an employee'),
  /** The calendar date and time of the punch, in the employee's own time zone. */
  date: dateOnly,
  time: timeOfDay,
  direction: z.enum(['IN', 'OUT']),
  note: z.string().trim().min(3, 'Say why this was recorded for them').max(500),
});
export type AdminPunchInput = z.input<typeof adminPunchSchema>;

/** A correction names the day and the right times, in the employee's local time. */
export const correctionSchema = z
  .object({
    employeeId: z.uuid().optional(),
    date: dateOnly,
    in: z.preprocess((v) => (v === '' ? undefined : v), timeOfDay.optional()),
    out: z.preprocess((v) => (v === '' ? undefined : v), timeOfDay.optional()),
    reason: z.string().trim().min(3, 'Say what happened').max(500),
  })
  .refine((v) => v.in !== undefined || v.out !== undefined, {
    path: ['in'],
    message: 'Give the clock-in time, the clock-out time, or both',
  });
export type CorrectionInput = z.input<typeof correctionSchema>;

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-04');

export const attendanceRangeSchema = z
  .object({ from: dateOnly, to: dateOnly })
  .refine((v) => v.from <= v.to, { path: ['to'], message: 'The end can’t be before the start' })
  .refine(
    (v) =>
      (new Date(`${v.to}T00:00:00Z`).getTime() - new Date(`${v.from}T00:00:00Z`).getTime()) / 86_400_000 < 62,
    { path: ['to'], message: 'Choose at most 62 days' },
  );

export const teamDayQuerySchema = z.object({
  date: dateOnly,
  search: z.string().trim().max(200).optional(),
  companyId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  status: z
    .enum(['PRESENT', 'HALF_DAY', 'ABSENT', 'WEEKLY_OFF', 'HOLIDAY', 'ON_LEAVE', 'NOT_IN', 'LATE'])
    .optional(),
});

export const registerQuerySchema = z.object({
  month,
  companyId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const correctionListQuerySchema = z.object({
  scope: z.enum(['mine', 'team']).default('mine'),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED']).optional(),
});

// ---- Biometric machines ------------------------------------------------------------------------

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const deviceTimeZone = z.string().trim().refine(isTimeZone, 'Choose a valid time zone, e.g. Asia/Kolkata');

export const biometricDeviceSchema = z.object({
  name: z.string().trim().min(2, 'Give the machine a name').max(80),
  vendor: z.enum(['ESSL', 'ZKTECO']).default('ESSL'),
  /** Printed on the machine and shown under its System Info. Machines identify themselves by it. */
  serialNumber: z
    .string()
    .trim()
    .min(4, 'Enter the serial number shown on the machine')
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, 'Letters, numbers, - and _ only'),
  location: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(120).optional()),
  timeZone: deviceTimeZone.default('Asia/Kolkata'),
});
export type BiometricDeviceInput = z.input<typeof biometricDeviceSchema>;

export const biometricDeviceUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    location: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(120).nullable()),
    timeZone: deviceTimeZone,
    status: z.enum(['ACTIVE', 'ARCHIVED']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');

/** The user number the machine knows the person by (its "User ID"), linked to an employee. */
export const biometricLinkSchema = z.object({
  employeeId: z.uuid('Choose an employee'),
  deviceCode: z
    .string()
    .trim()
    .min(1, 'Enter the user ID enrolled on the machine')
    .max(20)
    .regex(/^[A-Za-z0-9]+$/, 'Letters and numbers only'),
});

export const biometricLogQuerySchema = z.object({
  outcome: z.enum(['IMPORTED', 'UNMAPPED', 'DUPLICATE', 'REJECTED']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
