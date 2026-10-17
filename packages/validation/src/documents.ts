import { z } from 'zod';
import { dateOnly } from './employees.js';
import { nameField } from './org.js';

export const DOCUMENT_CATEGORIES = [
  'IDENTITY',
  'EDUCATION',
  'EMPLOYMENT',
  'CONTRACT',
  'LETTER',
  'POLICY',
  'MEDICAL',
  'OTHER',
] as const;
export type DocumentCategoryCode = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABEL: Record<DocumentCategoryCode, string> = {
  IDENTITY: 'Identity',
  EDUCATION: 'Education',
  EMPLOYMENT: 'Previous employment',
  CONTRACT: 'Contract',
  LETTER: 'Letter',
  POLICY: 'Policy',
  MEDICAL: 'Medical',
  OTHER: 'Other',
};

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optionalText = (max: number) =>
  z.preprocess(
    blankToNull,
    z.string().trim().max(max, `Use at most ${max} characters`).nullable().optional(),
  );
const titleField = z.string().trim().min(2, 'Use at least 2 characters').max(200, 'Title is too long');
/** Multipart fields arrive as text. */
const formBool = z.preprocess(
  (v) => (v === 'true' || v === 'on' || v === '1' ? true : v === 'false' || v === '0' ? false : v),
  z.boolean(),
);

/** The fields sent alongside an uploaded file. */
export const uploadDocumentSchema = z.object({
  title: titleField,
  category: z.enum(DOCUMENT_CATEGORIES),
  notes: optionalText(1000),
  visibleToEmployee: formBool.default(true),
  expiresOn: z.preprocess(blankToNull, dateOnly.nullable().optional()),
});
export type UploadDocumentInput = z.input<typeof uploadDocumentSchema>;

export const updateDocumentSchema = z
  .object({
    title: titleField.optional(),
    category: z.enum(DOCUMENT_CATEGORIES).optional(),
    notes: optionalText(1000),
    visibleToEmployee: z.boolean().optional(),
    expiresOn: z.preprocess(blankToNull, dateOnly.nullable().optional()),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');

export const documentListQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).default('ACTIVE'),
});

export const expiringQuerySchema = z.object({
  days: z.coerce.number().int().min(0).max(365).default(30),
});

// ---- Letter templates ------------------------------------------------------------------------------

/** What a letter template can fill in. Unknown placeholders are refused when the template is saved. */
export const LETTER_PLACEHOLDERS = {
  'employee.name': 'Full name (preferred first name if set)',
  'employee.firstName': 'First name',
  'employee.lastName': 'Last name',
  'employee.code': 'Employee code',
  'employee.designation': 'Designation',
  'employee.department': 'Department',
  'employee.branch': 'Branch',
  'employee.company': 'Company (legal name)',
  'employee.joinDate': 'Date of joining',
  'employee.workEmail': 'Work email',
  'employee.manager': 'Reporting manager',
  'organisation.name': 'Organisation name',
  today: 'Today’s date',
} as const;
export type LetterPlaceholder = keyof typeof LETTER_PLACEHOLDERS;

const PLACEHOLDER = /\{\{\s*([a-zA-Z.]+)\s*\}\}/g;

/** Placeholders used in a template body, in order of first use. */
export function placeholdersIn(body: string): string[] {
  return [...new Set([...body.matchAll(PLACEHOLDER)].map((m) => m[1]!))];
}

/** Fills `{{placeholders}}`; anything not in `values` is left visible so a mistake is obvious. */
export function fillPlaceholders(body: string, values: Partial<Record<string, string>>): string {
  return body.replace(PLACEHOLDER, (whole, key: string) => values[key] ?? whole);
}

const templateBody = z
  .string()
  .max(20_000, 'Keep the letter under 20,000 characters')
  .refine((v) => v.trim().length >= 10, 'Write the letter (at least 10 characters)')
  .superRefine((body, ctx) => {
    const unknown = placeholdersIn(body).filter((p) => !(p in LETTER_PLACEHOLDERS));
    if (unknown.length) {
      ctx.addIssue({
        code: 'custom',
        message: `Unknown placeholder${unknown.length > 1 ? 's' : ''}: ${unknown.map((u) => `{{${u}}}`).join(', ')}`,
      });
    }
  });

export const letterTemplateSchema = z.object({
  name: nameField,
  category: z.enum(DOCUMENT_CATEGORIES).default('LETTER'),
  body: templateBody,
});
export type LetterTemplateInput = z.input<typeof letterTemplateSchema>;

export const updateLetterTemplateSchema = z
  .object({
    name: nameField.optional(),
    category: z.enum(DOCUMENT_CATEGORIES).optional(),
    body: templateBody.optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');

export const generateLetterSchema = z.object({
  templateId: z.uuid('Choose a template'),
  title: titleField.optional(),
  visibleToEmployee: z.boolean().default(true),
});
export type GenerateLetterInput = z.input<typeof generateLetterSchema>;

// ---- Signatures ------------------------------------------------------------------------------------

export const signatureRequestSchema = z.object({
  title: titleField.optional(),
  message: optionalText(1000),
  /** Members who sign, in order. */
  signerMembershipIds: z
    .array(z.uuid())
    .min(1, 'Add at least one signer')
    .max(10, 'At most 10 signers')
    .refine((ids) => new Set(ids).size === ids.length, 'Each person signs once'),
  sequential: z.boolean().default(true),
  /** Days the signers have; none = no deadline. */
  expiresInDays: z.number().int().min(1).max(90).nullable().default(14),
});
export type SignatureRequestInput = z.input<typeof signatureRequestSchema>;

export const signSchema = z.object({
  /** The signer types their name as their signature. */
  signedName: z.string().trim().min(2, 'Type your full name').max(200),
  /** They confirm they have read the document and agree to sign electronically. */
  consent: z.literal(true, 'Confirm you have read the document and agree to sign it electronically'),
});

export const declineSchema = z.object({
  reason: z.string().trim().min(3, 'Say why you are declining').max(1000),
});

export const signatureListQuerySchema = z.object({
  scope: z.enum(['mine', 'sent', 'all']).default('mine'),
  status: z.enum(['PENDING', 'COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED']).optional(),
});
