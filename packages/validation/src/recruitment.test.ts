import { describe, expect, it } from 'vitest';
import {
  applicationSchema,
  interviewSchema,
  moveStageSchema,
  onboardingTemplateSchema,
} from './recruitment.js';

describe('recruitment input', () => {
  it('normalises candidate emails', () => {
    expect(
      applicationSchema.parse({ firstName: 'A', lastName: 'B', email: ' Asha@Example.TEST ' }).email,
    ).toBe('asha@example.test');
  });

  it('asks why when rejecting or withdrawing', () => {
    expect(moveStageSchema.safeParse({ stage: 'REJECTED' }).success).toBe(false);
    expect(moveStageSchema.safeParse({ stage: 'REJECTED', note: 'No licence' }).success).toBe(true);
    expect(moveStageSchema.safeParse({ stage: 'SCREENING' }).success).toBe(true);
    // Hiring only happens through an accepted offer.
    expect(moveStageSchema.safeParse({ stage: 'HIRED' }).success).toBe(false);
  });

  it('needs a time with its offset and distinct interviewers', () => {
    const id = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    expect(
      interviewSchema.safeParse({
        title: 'Round 1',
        scheduledAt: '2026-11-02T10:00',
        interviewerMembershipIds: [id],
      }).success,
    ).toBe(false);
    expect(
      interviewSchema.safeParse({
        title: 'Round 1',
        scheduledAt: '2026-11-02T10:00:00+05:30',
        interviewerMembershipIds: [id, id],
      }).success,
    ).toBe(false);
    expect(
      interviewSchema.parse({
        title: 'Round 1',
        scheduledAt: '2026-11-02T04:30:00Z',
        interviewerMembershipIds: [id],
      }).durationMinutes,
    ).toBe(60);
  });

  it('keeps onboarding due days within bounds', () => {
    const base = { name: 'Joiners', tasks: [{ title: 'Laptop', assignee: 'HR', dueOffsetDays: -90 }] };
    expect(onboardingTemplateSchema.safeParse(base).success).toBe(false);
    expect(onboardingTemplateSchema.safeParse({ ...base, tasks: [] }).success).toBe(false);
    expect(
      onboardingTemplateSchema.parse({ ...base, tasks: [{ title: 'Laptop', assignee: 'HR' }] }).tasks[0]
        ?.dueOffsetDays,
    ).toBe(0);
  });
});
