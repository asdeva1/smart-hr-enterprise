import { describe, expect, it } from 'vitest';
import { approvalDecisionSchema, approvalPolicyDefinitionSchema, delegationSchema } from './approvals.js';

const roleId = '01890a5d-ac96-774b-bcce-b302099a8057';

describe('approvalPolicyDefinitionSchema', () => {
  it('accepts a two-stage policy with an amount threshold and defaults separation of duties on', () => {
    const parsed = approvalPolicyDefinitionSchema.parse({
      stages: [
        { name: 'Manager', mode: 'ANY', approvers: [{ type: 'ROLE', roleId }] },
        {
          name: 'Finance',
          mode: 'ALL',
          approvers: [{ type: 'OWNERS' }],
          minAmount: '50000.00',
          dueInHours: 48,
        },
      ],
    });
    expect(parsed.distinctApprovers).toBe(true);
  });

  it('rejects empty stages, unknown approver types and malformed amounts', () => {
    expect(approvalPolicyDefinitionSchema.safeParse({ stages: [] }).success).toBe(false);
    expect(
      approvalPolicyDefinitionSchema.safeParse({
        stages: [{ name: 'X1', mode: 'ANY', approvers: [{ type: 'ANYONE' }] }],
      }).success,
    ).toBe(false);
    expect(
      approvalPolicyDefinitionSchema.safeParse({
        stages: [{ name: 'X1', mode: 'ANY', approvers: [{ type: 'OWNERS' }], minAmount: '-5' }],
      }).success,
    ).toBe(false);
  });
});

describe('approvalDecisionSchema', () => {
  it('needs a reason to reject or send back, not to approve', () => {
    expect(approvalDecisionSchema.safeParse({ decision: 'APPROVE' }).success).toBe(true);
    expect(approvalDecisionSchema.safeParse({ decision: 'REJECT' }).success).toBe(false);
    expect(
      approvalDecisionSchema.safeParse({ decision: 'RETURN', comment: 'Attach the receipt' }).success,
    ).toBe(true);
  });
});

describe('delegationSchema', () => {
  it('needs an end after the start and at most 90 days', () => {
    const base = { toMembershipId: roleId, startsAt: '2026-11-01T00:00:00+05:30' };
    expect(delegationSchema.safeParse({ ...base, endsAt: '2026-11-10T00:00:00+05:30' }).success).toBe(true);
    expect(delegationSchema.safeParse({ ...base, endsAt: '2026-10-30T00:00:00+05:30' }).success).toBe(false);
    expect(delegationSchema.safeParse({ ...base, endsAt: '2027-03-01T00:00:00+05:30' }).success).toBe(false);
  });
});
