import { describe, expect, it } from 'vitest';
import {
  colleagueFeedbackSchema,
  goalSchema,
  reviewCycleSchema,
  selfReviewSchema,
  weightedProgress,
} from './performance.js';

describe('performance schemas', () => {
  it('needs a cycle to end on or after it starts', () => {
    const base = { companyId: '0190a000-0000-7000-8000-000000000001', name: 'FY 2026-27' };
    expect(
      reviewCycleSchema.safeParse({ ...base, periodFrom: '2026-04-01', periodTo: '2027-03-31' }).success,
    ).toBe(true);
    expect(
      reviewCycleSchema.safeParse({ ...base, periodFrom: '2027-04-01', periodTo: '2027-03-31' }).success,
    ).toBe(false);
  });

  it('keeps goal weight and ratings in range', () => {
    const cycleId = '0190a000-0000-7000-8000-000000000001';
    expect(goalSchema.safeParse({ cycleId, title: 'Ship it', weight: 0 }).success).toBe(false);
    expect(goalSchema.safeParse({ cycleId, title: 'Ship it', weight: 101 }).success).toBe(false);
    expect(goalSchema.safeParse({ cycleId, title: 'Ship it', weight: 40 }).success).toBe(true);
    expect(selfReviewSchema.safeParse({ rating: 6, comment: 'fine' }).success).toBe(false);
    expect(selfReviewSchema.safeParse({ rating: 4.5, comment: 'fine' }).success).toBe(false);
    expect(selfReviewSchema.safeParse({ rating: 5, comment: 'fine' }).success).toBe(true);
  });

  it('refuses blank feedback', () => {
    expect(
      colleagueFeedbackSchema.safeParse({
        toId: '0190a000-0000-7000-8000-000000000001',
        kind: 'PRAISE',
        message: '  ',
      }).success,
    ).toBe(false);
  });

  it('weights progress and ignores dropped goals', () => {
    expect(weightedProgress([])).toBe(0);
    expect(
      weightedProgress([
        { weight: 50, progress: 20, status: 'ACTIVE' },
        { weight: 50, progress: 0, status: 'ACHIEVED' },
        { weight: 30, progress: 100, status: 'DROPPED' },
      ]),
    ).toBe(60);
  });
});
