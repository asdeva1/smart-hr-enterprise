import { z } from 'zod';
import { dateOnly } from './employees.js';

const optionalMinutes = (min: number, max: number) =>
  z.preprocess((v) => (v === '' || v === null ? null : v), z.number().int().min(min).max(max).nullable());

/** The organisation's attendance rules. */
export const attendancePolicySchema = z.object({
  overtimeEnabled: z.boolean(),
  overtimeThresholdMinutes: z.number().int().min(0).max(600),
  overtimeRoundMinutes: z.union([
    z.literal(1),
    z.literal(5),
    z.literal(10),
    z.literal(15),
    z.literal(30),
    z.literal(60),
  ]),
  overtimeDailyCapMinutes: optionalMinutes(15, 960),
  overtimeOffDayCounts: z.boolean(),
  overtimeNeedsApproval: z.boolean(),
  maxCorrectionsPerMonth: optionalMinutes(0, 60),
  maxCorrectionBackdateDays: optionalMinutes(0, 365),
  geofenceMode: z.enum(['OFF', 'WARN', 'ENFORCE']),
});
export type AttendancePolicyInput = z.input<typeof attendancePolicySchema>;

const locationFields = {
  name: z.string().trim().min(2, 'Give the place a name').max(80),
  latitude: z.number().min(-90, 'Latitude is between -90 and 90').max(90, 'Latitude is between -90 and 90'),
  longitude: z
    .number()
    .min(-180, 'Longitude is between -180 and 180')
    .max(180, 'Longitude is between -180 and 180'),
  radiusMeters: z.number().int().min(20, 'At least 20 metres').max(50_000, 'At most 50 km'),
};
export const workLocationSchema = z.object(locationFields);
export type WorkLocationInput = z.input<typeof workLocationSchema>;
export const updateWorkLocationSchema = z.object({
  ...locationFields,
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});
export type UpdateWorkLocationInput = z.input<typeof updateWorkLocationSchema>;

const days = (v: { from: string; to: string }) =>
  (new Date(`${v.to}T00:00:00Z`).getTime() - new Date(`${v.from}T00:00:00Z`).getTime()) / 86_400_000;

export const rosterQuerySchema = z
  .object({
    from: dateOnly,
    to: dateOnly,
    search: z.string().trim().max(200).optional(),
    departmentId: z.uuid().optional(),
  })
  .refine((v) => v.from <= v.to, { path: ['to'], message: 'The end can’t be before the start' })
  .refine((v) => days(v) < 42, { path: ['to'], message: 'Choose at most 6 weeks' });

/** Puts people on a shift (or a day off) for a run of dates, optionally only on some weekdays. */
export const setRosterSchema = z
  .object({
    employeeIds: z.array(z.uuid()).min(1, 'Choose at least one person').max(200),
    from: dateOnly,
    to: dateOnly,
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    /** The shift to work, or null for a day off. */
    shiftId: z.uuid().nullable(),
  })
  .refine((v) => v.from <= v.to, { path: ['to'], message: 'The end can’t be before the start' })
  .refine((v) => days(v) < 62, { path: ['to'], message: 'Choose at most 62 days' });
export type SetRosterInput = z.input<typeof setRosterSchema>;

export const clearRosterSchema = z
  .object({
    employeeIds: z.array(z.uuid()).min(1).max(200),
    from: dateOnly,
    to: dateOnly,
  })
  .refine((v) => v.from <= v.to, { path: ['to'], message: 'The end can’t be before the start' })
  .refine((v) => days(v) < 62, { path: ['to'], message: 'Choose at most 62 days' });
export type ClearRosterInput = z.input<typeof clearRosterSchema>;

export const overtimeQuerySchema = z
  .object({
    from: dateOnly,
    to: dateOnly,
    status: z.enum(['PENDING', 'DECIDED', 'ALL']).default('PENDING'),
  })
  .refine((v) => v.from <= v.to, { path: ['to'], message: 'The end can’t be before the start' })
  .refine((v) => days(v) < 93, { path: ['to'], message: 'Choose at most 3 months' });

export const decideOvertimeSchema = z
  .object({
    employeeId: z.uuid(),
    date: dateOnly,
    decision: z.enum(['APPROVED', 'REJECTED']),
    /** Minutes to approve; defaults to all of the day's overtime. */
    minutes: z.number().int().min(1).max(960).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.decision === 'APPROVED' || v.minutes === undefined, {
    path: ['minutes'],
    message: 'A rejection approves no minutes',
  });
export type DecideOvertimeInput = z.input<typeof decideOvertimeSchema>;
