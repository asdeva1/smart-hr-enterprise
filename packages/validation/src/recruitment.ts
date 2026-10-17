import { z } from 'zod';
import { dateOnly } from './employees.js';
import { nameField } from './org.js';

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optionalText = (max: number) =>
  z.preprocess(
    blankToNull,
    z.string().trim().max(max, `Use at most ${max} characters`).nullable().optional(),
  );
const optionalId = z.preprocess(blankToNull, z.uuid().nullable().optional());
const titleField = z.string().trim().min(2, 'Use at least 2 characters').max(200, 'Title is too long');
const personName = z.string().trim().min(1, 'Required').max(100, 'Too long');

// ---- Openings --------------------------------------------------------------------------------------

export const jobOpeningSchema = z.object({
  title: titleField,
  companyId: z.uuid('Choose a company'),
  branchId: optionalId,
  departmentId: optionalId,
  designationId: optionalId,
  employmentTypeId: optionalId,
  hiringManagerId: optionalId,
  positions: z.coerce.number().int().min(1, 'At least one').max(500, 'Too many').default(1),
  description: z.string().trim().min(10, 'Describe the role (at least 10 characters)').max(10_000),
});
export type JobOpeningInput = z.input<typeof jobOpeningSchema>;

export const updateJobOpeningSchema = z
  .object({
    title: titleField.optional(),
    branchId: optionalId,
    departmentId: optionalId,
    designationId: optionalId,
    employmentTypeId: optionalId,
    hiringManagerId: optionalId,
    positions: z.coerce.number().int().min(1).max(500).optional(),
    description: z.string().trim().min(10).max(10_000).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');

/** Hold, reopen or close an opening that is open. */
export const openingStatusSchema = z.object({
  status: z.enum(['OPEN', 'ON_HOLD', 'CLOSED']),
  note: optionalText(500),
});

export const openingListQuerySchema = z.object({
  status: z
    .enum(['DRAFT', 'PENDING_APPROVAL', 'OPEN', 'ON_HOLD', 'CLOSED', 'ACTIVE', 'ALL'])
    .default('ACTIVE'),
});

// ---- Candidates and applications ---------------------------------------------------------------------

export const CANDIDATE_SOURCES = [
  'Referral',
  'Careers page',
  'Job board',
  'Agency',
  'Campus',
  'Walk-in',
  'Other',
] as const;

/** A candidate added to an opening. An existing candidate (same email) is reused, not duplicated. */
export const applicationSchema = z.object({
  firstName: personName,
  lastName: personName,
  email: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.email('Enter a valid email').max(254),
  ),
  phone: optionalText(30),
  source: optionalText(60),
  notes: optionalText(2000),
});
export type ApplicationInput = z.input<typeof applicationSchema>;

export const APPLICATION_STAGES = [
  'APPLIED',
  'SCREENING',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
] as const;
export type ApplicationStageCode = (typeof APPLICATION_STAGES)[number];

/** Stages someone can be moved to by hand (hiring happens through an accepted offer). */
export const moveStageSchema = z
  .object({
    stage: z.enum(['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN']),
    note: optionalText(1000),
  })
  .refine((v) => !(v.stage === 'REJECTED' || v.stage === 'WITHDRAWN') || (v.note && v.note.length >= 3), {
    message: 'Say why',
    path: ['note'],
  });

// ---- Interviews ------------------------------------------------------------------------------------

export const interviewSchema = z.object({
  title: titleField,
  scheduledAt: z.iso.datetime({ offset: true, message: 'Choose a date and time' }),
  durationMinutes: z.coerce.number().int().min(15).max(480).default(60),
  location: optionalText(300),
  interviewerMembershipIds: z
    .array(z.uuid())
    .min(1, 'Add at least one interviewer')
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length, 'Each interviewer once'),
});
export type InterviewInput = z.input<typeof interviewSchema>;

export const interviewStatusSchema = z.object({ status: z.enum(['COMPLETED', 'CANCELLED']) });

export const feedbackSchema = z.object({
  rating: z.coerce.number().int().min(1, 'Rate 1 to 5').max(5, 'Rate 1 to 5'),
  recommendation: z.enum(['STRONG_YES', 'YES', 'NO', 'STRONG_NO']),
  comments: z.string().trim().min(10, 'Say what you saw (at least 10 characters)').max(5000),
});

// ---- Offers ----------------------------------------------------------------------------------------

export const offerSchema = z.object({
  designationId: optionalId,
  joiningDate: dateOnly,
  annualCtc: z.preprocess(blankToNull, z.coerce.number().positive().max(1_000_000_000).nullable().optional()),
  notes: optionalText(2000),
});
export type OfferInput = z.input<typeof offerSchema>;

export const offerResponseSchema = z.object({
  response: z.enum(['ACCEPTED', 'DECLINED']),
  note: optionalText(1000),
});

/** Turning an accepted offer into an employee record. */
export const hireSchema = z.object({
  workEmail: z.preprocess(blankToNull, z.email().trim().toLowerCase().nullable().optional()),
  managerId: optionalId,
  onboardingTemplateId: optionalId,
});

// ---- Onboarding ------------------------------------------------------------------------------------

export const ONBOARDING_ASSIGNEES = ['HR', 'MANAGER', 'EMPLOYEE'] as const;

export const onboardingTemplateSchema = z.object({
  name: nameField,
  tasks: z
    .array(
      z.object({
        title: titleField,
        description: optionalText(1000),
        assignee: z.enum(ONBOARDING_ASSIGNEES),
        dueOffsetDays: z.coerce.number().int().min(-60).max(180).default(0),
      }),
    )
    .min(1, 'Add at least one task')
    .max(50),
  status: z.enum(['ACTIVE', 'ARCHIVED']).default('ACTIVE'),
});
export type OnboardingTemplateInput = z.input<typeof onboardingTemplateSchema>;

export const startOnboardingSchema = z.object({
  templateId: z.uuid('Choose a checklist'),
  startDate: dateOnly.optional(),
});

export const completeTaskSchema = z.object({
  status: z.enum(['DONE', 'SKIPPED', 'OPEN']),
  note: optionalText(1000),
});
