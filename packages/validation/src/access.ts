import { z } from 'zod';
import { emailField } from './auth.js';

export const scopeTypeField = z.enum(['TENANT', 'COMPANY', 'BRANCH', 'DEPARTMENT']);

export const roleAssignmentSchema = z
  .object({
    roleId: z.uuid('Choose a role'),
    scopeType: scopeTypeField,
    /** Required for COMPANY, BRANCH and DEPARTMENT; ignored for TENANT. */
    scopeId: z.uuid().nullable().optional(),
  })
  .refine((v) => v.scopeType === 'TENANT' || !!v.scopeId, {
    message: 'Choose where this role applies',
    path: ['scopeId'],
  });
export type RoleAssignmentInput = z.input<typeof roleAssignmentSchema>;

export const inviteMemberSchema = z.object({
  email: emailField,
  displayName: z.string().trim().min(1, 'Enter a name').max(200, 'Name is too long'),
  assignments: z.array(roleAssignmentSchema).max(20).default([]),
});
export type InviteMemberInput = z.input<typeof inviteMemberSchema>;

export const updateMemberSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  isTenantAdmin: z.boolean().optional(),
});
export type UpdateMemberInput = z.input<typeof updateMemberSchema>;

export const memberListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const roleKeyField = z
  .string()
  .trim()
  .min(2)
  .max(50)
  .regex(/^[a-z][a-z0-9_]*$/, 'Use lower-case letters, digits and underscores');

export const createRoleSchema = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters').max(100, 'Name is too long'),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  permissions: z.array(z.string().min(3).max(100)).max(500).default([]),
});
export type CreateRoleInput = z.input<typeof createRoleSchema>;

export const updateRoleSchema = createRoleSchema.partial();
export type UpdateRoleInput = z.input<typeof updateRoleSchema>;

export const securityPolicySchema = z.object({ requireMfa: z.boolean() });
export type SecurityPolicyInput = z.input<typeof securityPolicySchema>;

export const auditQuerySchema = z.object({
  action: z.string().trim().max(100).optional(),
  actorUserId: z.uuid().optional(),
  outcome: z.enum(['SUCCESS', 'FAILURE', 'DENIED']).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  /** Id of the last event on the previous page (events are returned newest first). */
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
