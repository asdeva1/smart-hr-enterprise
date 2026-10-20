import { z } from 'zod';
import { dateOnly } from './employees.js';
import { codeField, nameField } from './org.js';

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());

const keyField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use lower-case letters, digits and underscores, starting with a letter');

export const stageKindSchema = z.enum(['OPEN', 'DONE', 'CANCELLED']);
export const fieldTypeSchema = z.enum(['TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN']);
export const prioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

export const stageDefinitionSchema = z.object({
  key: keyField,
  label: z.string().trim().min(1, 'Give the stage a name').max(60),
  kind: stageKindSchema,
});

export const fieldDefinitionSchema = z
  .object({
    key: keyField,
    label: z.string().trim().min(1, 'Give the field a name').max(80),
    type: fieldTypeSchema,
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  })
  .refine((f) => f.type !== 'SELECT' || (f.options?.length ?? 0) >= 2, {
    path: ['options'],
    message: 'A choice field needs at least two choices',
  });

export const definitionSchema = z
  .object({
    stages: z.array(stageDefinitionSchema).min(2, 'Add at least two stages').max(20),
    fields: z.array(fieldDefinitionSchema).max(30),
  })
  .superRefine((d, ctx) => {
    if (new Set(d.stages.map((s) => s.key)).size !== d.stages.length) {
      ctx.addIssue({ code: 'custom', path: ['stages'], message: 'Each stage needs its own key' });
    }
    if (new Set(d.fields.map((f) => f.key)).size !== d.fields.length) {
      ctx.addIssue({ code: 'custom', path: ['fields'], message: 'Each field needs its own key' });
    }
    if (!d.stages.some((s) => s.kind === 'OPEN')) {
      ctx.addIssue({ code: 'custom', path: ['stages'], message: 'At least one stage must be open work' });
    }
    if (!d.stages.some((s) => s.kind === 'DONE')) {
      ctx.addIssue({ code: 'custom', path: ['stages'], message: 'At least one stage must mean done' });
    }
    if (d.stages[0]?.kind !== 'OPEN') {
      ctx.addIssue({
        code: 'custom',
        path: ['stages'],
        message: 'The first stage is where new items start, so it must be open',
      });
    }
  });

export const workspaceSchema = z.object({
  companyId: z.uuid('Choose a company'),
  code: codeField,
  name: nameField,
  description: optionalText(1000),
  /** A built-in template to start from; leave out to start with plain stages and no extra fields. */
  template: z.preprocess(blankToNull, z.string().trim().max(40).nullable()).optional(),
});

export const updateWorkspaceSchema = z
  .object({
    name: nameField.optional(),
    description: optionalText(1000),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');

export const itemValuesSchema = z.record(
  z.string().max(40),
  z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]),
);

export const opsItemSchema = z.object({
  title: z.string().trim().min(2, 'Give it a title').max(200),
  description: optionalText(5000),
  priority: prioritySchema.default('NORMAL'),
  assigneeId: z.preprocess(blankToNull, z.uuid().nullable()).optional(),
  dueDate: z.preprocess(blankToNull, dateOnly.nullable()).optional(),
  values: itemValuesSchema.default({}),
});

export const updateOpsItemSchema = z
  .object({
    title: z.string().trim().min(2).max(200).optional(),
    description: optionalText(5000),
    priority: prioritySchema.optional(),
    assigneeId: z.preprocess(blankToNull, z.uuid().nullable()).optional(),
    dueDate: z.preprocess(blankToNull, dateOnly.nullable()).optional(),
    values: itemValuesSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');

export const opsTransitionSchema = z.object({
  stageId: z.uuid('Choose a stage'),
  comment: optionalText(2000),
});

export const opsCommentSchema = z.object({ body: z.string().trim().min(1, 'Write something').max(2000) });

export const opsItemListQuerySchema = z.object({
  stageId: z.uuid().optional(),
  assigneeId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  open: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
