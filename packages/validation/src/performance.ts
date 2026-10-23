import { z } from 'zod';
import { dateOnly } from './employees.js';

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
const rating = z.coerce
  .number()
  .int()
  .min(1, 'Choose a rating from 1 to 5')
  .max(5, 'Choose a rating from 1 to 5');

export const reviewCycleSchema = z
  .object({
    companyId: z.uuid('Choose a company'),
    name: z.string().trim().min(2, 'Name the cycle').max(100),
    periodFrom: dateOnly,
    periodTo: dateOnly,
  })
  .refine((v) => v.periodTo >= v.periodFrom, {
    message: 'The end can’t be before the start',
    path: ['periodTo'],
  });
export type ReviewCycleInput = z.input<typeof reviewCycleSchema>;

export const cycleListQuerySchema = z.object({ companyId: z.uuid().optional() });

export const goalSchema = z.object({
  cycleId: z.uuid('Choose a cycle'),
  /** Leave out to set a goal for yourself. */
  employeeId: z.uuid().optional(),
  title: z.string().trim().min(3, 'Say what the goal is').max(200),
  description: optionalText(2000),
  weight: z.coerce.number().int().min(1, 'At least 1').max(100, 'At most 100'),
});
export type GoalInput = z.input<typeof goalSchema>;

export const updateGoalSchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    description: optionalText(2000),
    weight: z.coerce.number().int().min(1).max(100).optional(),
    progress: z.coerce.number().int().min(0).max(100).optional(),
    status: z.enum(['ACTIVE', 'ACHIEVED', 'DROPPED']).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');

export const selfReviewSchema = z.object({
  rating,
  comment: z.string().trim().min(3, 'Say how the period went').max(4000),
});

export const managerReviewSchema = z.object({
  rating,
  comment: z.string().trim().min(3, 'Add your assessment').max(4000),
});

export const appraisalListQuerySchema = z.object({
  status: z.enum(['AWAITING_SELF', 'AWAITING_MANAGER', 'COMPLETED', 'ACKNOWLEDGED', 'ALL']).default('ALL'),
});

export const colleagueFeedbackSchema = z.object({
  toId: z.uuid('Choose who this is for'),
  kind: z.enum(['PRAISE', 'SUGGESTION']),
  message: z.string().trim().min(3, 'Write your feedback').max(2000),
});
export type FeedbackInput = z.input<typeof colleagueFeedbackSchema>;

/** Averages and weighted progress shown against a person's goals. */
export function weightedProgress(goals: { weight: number; progress: number; status: string }[]): number {
  const live = goals.filter((g) => g.status !== 'DROPPED');
  const total = live.reduce((n, g) => n + g.weight, 0);
  if (total === 0) return 0;
  const done = live.reduce((n, g) => n + g.weight * (g.status === 'ACHIEVED' ? 100 : g.progress), 0);
  return Math.round(done / total);
}
