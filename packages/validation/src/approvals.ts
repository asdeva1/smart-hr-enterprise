import { z } from 'zod';

/** Who may approve a stage. Resolved when the stage starts, for the request's place in the organisation. */
export const approverRuleSchema = z.discriminatedUnion('type', [
  /** Members holding this role at a scope covering the request. */
  z.object({ type: z.literal('ROLE'), roleId: z.uuid('Choose a role') }),
  /** Members holding this permission at a scope covering the request. */
  z.object({ type: z.literal('PERMISSION'), permission: z.string().min(3, 'Choose a permission').max(100) }),
  /** One named member. */
  z.object({ type: z.literal('MEMBER'), membershipId: z.uuid('Choose a person') }),
  /** The organisation's owners. */
  z.object({ type: z.literal('OWNERS') }),
]);
export type ApproverRule = z.infer<typeof approverRuleSchema>;

/** Exact decimal amount as a string, e.g. "50000" or "1250.50". */
export const decimalString = z
  .string()
  .trim()
  .regex(/^\d{1,15}(\.\d{1,4})?$/, 'Use a positive amount with up to 4 decimal places');

export const approvalStageSchema = z.object({
  name: z.string().trim().min(2, 'Name the stage').max(100),
  /** ANY: the first approval completes the stage. ALL: every assigned approver must approve. */
  mode: z.enum(['ANY', 'ALL']),
  approvers: z.array(approverRuleSchema).min(1, 'Add at least one approver').max(10),
  /** The stage applies only when the request amount is at least this much. */
  minAmount: decimalString.optional(),
  /** Approvers are reminded, and owners alerted, after this many hours. */
  dueInHours: z.number().int().min(1).max(720).optional(),
});
export type ApprovalStage = z.infer<typeof approvalStageSchema>;

export const approvalPolicyDefinitionSchema = z.object({
  stages: z.array(approvalStageSchema).min(1, 'Add at least one stage').max(10),
  /** Separation of duties: someone who approved one stage can't approve a later one. */
  distinctApprovers: z.boolean().default(true),
});
export type ApprovalPolicyDefinition = z.infer<typeof approvalPolicyDefinitionSchema>;

export const createApprovalPolicySchema = z.object({
  subjectType: z.string().min(2).max(60),
  name: z.string().trim().min(2).max(120),
  definition: approvalPolicyDefinitionSchema,
});
export type CreateApprovalPolicyInput = z.input<typeof createApprovalPolicySchema>;

export const approvalDecisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'RETURN']),
    comment: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.decision === 'APPROVE' || (v.comment?.length ?? 0) >= 3, {
    path: ['comment'],
    message: 'Say why, so the requester knows what to do',
  });
export type ApprovalDecisionInput = z.input<typeof approvalDecisionSchema>;

export const approvalListQuerySchema = z.object({
  view: z.enum(['mine', 'all']).default('mine'),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const delegationSchema = z
  .object({
    toMembershipId: z.uuid('Choose who approves for you'),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    path: ['endsAt'],
    message: 'End after the start',
  })
  .refine((v) => Date.parse(v.endsAt) - Date.parse(v.startsAt) <= 90 * 86_400_000, {
    path: ['endsAt'],
    message: 'Delegate for 90 days at most',
  });
export type DelegationInput = z.input<typeof delegationSchema>;

export const notificationPreferenceSchema = z.object({
  category: z.string().min(3).max(60),
  emailEnabled: z.boolean(),
});
