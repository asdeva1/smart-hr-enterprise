import { z } from 'zod';
import { emailField } from './auth.js';

/** Calendar date as YYYY-MM-DD, rejecting impossible dates such as 2026-02-30. */
export const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-04-01')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'This date doesn’t exist');

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable()).optional();
const optionalId = z.preprocess(blankToNull, z.uuid().nullable()).optional();
const optionalDate = z.preprocess(blankToNull, dateOnly.nullable()).optional();

export const employeeCodeField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,29}$/, 'Use up to 30 letters, digits, - or _');

const personName = (label: string) =>
  z.string().trim().min(1, `Enter the ${label}`).max(100, `The ${label} is too long`);

/** Indian mobile or international number: digits, spaces, +, - and brackets, 7–15 digits in total. */
export const phoneField = z
  .string()
  .trim()
  .max(25)
  .refine(
    (v) =>
      /^[+\d][\d\s()-]*$/.test(v) && v.replace(/\D/g, '').length >= 7 && v.replace(/\D/g, '').length <= 15,
    {
      message: 'Use a phone number such as +91 98765 43210',
    },
  );

export const GENDERS = ['FEMALE', 'MALE', 'NON_BINARY', 'UNDISCLOSED'] as const;
export const EMPLOYEE_STATUSES = ['ACTIVE', 'ON_NOTICE', 'EXITED'] as const;

const employeeFields = {
  firstName: personName('first name'),
  lastName: personName('last name'),
  preferredName: optionalText(100),
  workEmail: z.preprocess(blankToNull, emailField.nullable()).optional(),
  personalEmail: z.preprocess(blankToNull, emailField.nullable()).optional(),
  phone: z.preprocess(blankToNull, phoneField.nullable()).optional(),
  dateOfBirth: optionalDate,
  gender: z.preprocess(blankToNull, z.enum(GENDERS).nullable()).optional(),
  companyId: z.uuid('Choose a company'),
  branchId: optionalId,
  departmentId: optionalId,
  designationId: optionalId,
  gradeId: optionalId,
  employmentTypeId: optionalId,
  costCentreId: optionalId,
  managerId: optionalId,
  dateOfJoining: dateOnly,
  probationEndDate: optionalDate,
};

interface DateBits {
  dateOfBirth?: string | null | undefined;
  dateOfJoining?: string | undefined;
  probationEndDate?: string | null | undefined;
}
type IssueSink = { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void };

function datesInOrder(v: DateBits, ctx: IssueSink): void {
  if (v.dateOfBirth && v.dateOfJoining && v.dateOfBirth >= v.dateOfJoining) {
    ctx.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'Must be before the joining date' });
  }
  if (v.probationEndDate && v.dateOfJoining && v.probationEndDate < v.dateOfJoining) {
    ctx.addIssue({
      code: 'custom',
      path: ['probationEndDate'],
      message: 'Must be on or after the joining date',
    });
  }
}

/** Leave `employeeCode` empty to number the employee automatically (EMP-0001, …). */
export const createEmployeeSchema = z
  .object({
    employeeCode: z.preprocess(blankToNull, employeeCodeField.nullable()).optional(),
    ...employeeFields,
  })
  .superRefine((v, ctx) => datesInOrder(v, ctx));
export type CreateEmployeeInput = z.input<typeof createEmployeeSchema>;

/**
 * Corrections to the record. Organisation placement, designation, grade and manager changes that are real
 * career events go through lifecycle actions instead, so they appear in the history with an effective date.
 * `version` must be the version the change was based on; a stale version is refused.
 */
export const updateEmployeeSchema = z
  .object({
    version: z.number().int().min(1),
    firstName: employeeFields.firstName.optional(),
    lastName: employeeFields.lastName.optional(),
    preferredName: employeeFields.preferredName,
    workEmail: employeeFields.workEmail,
    personalEmail: employeeFields.personalEmail,
    phone: employeeFields.phone,
    dateOfBirth: employeeFields.dateOfBirth,
    gender: employeeFields.gender,
    employmentTypeId: employeeFields.employmentTypeId,
    dateOfJoining: dateOnly.optional(),
    probationEndDate: employeeFields.probationEndDate,
  })
  .superRefine((v, ctx) => datesInOrder(v, ctx));
export type UpdateEmployeeInput = z.input<typeof updateEmployeeSchema>;

const note = optionalText(500);

export const employeeLifecycleSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('transfer'),
    version: z.number().int().min(1),
    effectiveDate: dateOnly,
    companyId: z.uuid().optional(),
    branchId: optionalId,
    departmentId: optionalId,
    costCentreId: optionalId,
    note,
  }),
  z.object({
    action: z.literal('promotion'),
    version: z.number().int().min(1),
    effectiveDate: dateOnly,
    designationId: optionalId,
    gradeId: optionalId,
    note,
  }),
  z.object({
    action: z.literal('change_manager'),
    version: z.number().int().min(1),
    effectiveDate: dateOnly,
    managerId: z.preprocess(blankToNull, z.uuid().nullable()),
    note,
  }),
  z.object({
    action: z.literal('notice'),
    version: z.number().int().min(1),
    noticeGivenOn: dateOnly,
    lastWorkingDay: dateOnly,
    exitReasonId: optionalId,
    note,
  }),
  z.object({
    action: z.literal('withdraw_notice'),
    version: z.number().int().min(1),
    effectiveDate: dateOnly,
    note,
  }),
  z.object({
    action: z.literal('exit'),
    version: z.number().int().min(1),
    exitedOn: dateOnly,
    exitReasonId: z.uuid('Choose an exit reason'),
    note,
  }),
]);
export type EmployeeLifecycleInput = z.input<typeof employeeLifecycleSchema>;

// ---- Identity and bank details --------------------------------------------------------------

/** Verhoeff checksum, used by Aadhaar numbers. */
export function verhoeffValid(digits: string): boolean {
  const d = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  ];
  const p = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
  ];
  let c = 0;
  const reversed = digits.split('').reverse();
  for (let i = 0; i < reversed.length; i++) c = d[c]![p[i % 8]![Number(reversed[i])]!]!;
  return c === 0;
}

const compact = (v: unknown) => (typeof v === 'string' ? v.replace(/[\s-]/g, '').toUpperCase() : v);
const sensitive = <T extends z.ZodType>(inner: T) =>
  z.preprocess((v) => (v === '' ? null : compact(v)), inner.nullable()).optional();

/** Omitted fields stay as they are; null (or an empty string) clears a field. */
export const employeeSensitiveSchema = z.object({
  pan: sensitive(z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Use a PAN like ABCDE1234F')),
  aadhaar: sensitive(
    z
      .string()
      .regex(/^[2-9]\d{11}$/, 'Use the 12-digit Aadhaar number')
      .refine(verhoeffValid, 'This Aadhaar number has a typo (its check digit doesn’t match)'),
  ),
  bankAccount: sensitive(z.string().regex(/^\d{9,18}$/, 'Use 9 to 18 digits')),
  bankIfsc: sensitive(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Use an IFSC like HDFC0001234')),
  bankName: optionalText(100),
  uan: sensitive(z.string().regex(/^\d{12}$/, 'Use the 12-digit UAN')),
});
export type EmployeeSensitiveInput = z.input<typeof employeeSensitiveSchema>;

export const emergencyContactSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(100),
  relationship: z.string().trim().min(1, 'Enter the relationship').max(50),
  phone: phoneField,
  email: z.preprocess(blankToNull, emailField.nullable()).optional(),
  isPrimary: z.boolean().default(false),
});
export type EmergencyContactInput = z.input<typeof emergencyContactSchema>;

export const employeeListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum([...EMPLOYEE_STATUSES, 'CURRENT', 'ALL']).default('CURRENT'),
  companyId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  managerId: z.uuid().optional(),
  sort: z.enum(['name', 'code', 'joined']).default('name'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type EmployeeListQuery = z.input<typeof employeeListQuerySchema>;

export const inviteEmployeeSchema = z.object({ roleId: z.uuid('Choose a role').optional() });

// ---- CSV import -------------------------------------------------------------------------------

/**
 * Parses CSV text (RFC 4180: quoted fields, doubled quotes, CRLF or LF). Returns rows of raw strings.
 * Throws on an unterminated quote.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (quoted) throw new Error('A quoted value is never closed');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** Columns the import understands, in template order. Codes refer to existing organisation records. */
export const EMPLOYEE_IMPORT_COLUMNS = [
  'employee_code',
  'first_name',
  'last_name',
  'work_email',
  'phone',
  'date_of_joining',
  'date_of_birth',
  'gender',
  'company_code',
  'branch_code',
  'department_code',
  'designation_code',
  'grade_code',
  'employment_type_code',
  'cost_centre_code',
  'manager_code',
] as const;
export type EmployeeImportColumn = (typeof EMPLOYEE_IMPORT_COLUMNS)[number];
export const REQUIRED_IMPORT_COLUMNS: EmployeeImportColumn[] = [
  'first_name',
  'last_name',
  'date_of_joining',
  'company_code',
];

export const MAX_IMPORT_ROWS = 2000;

export const employeeImportSchema = z.object({
  csv: z.string().min(1, 'Choose a file').max(2_000_000, 'The file is too large (2 MB at most)'),
  /** true: check everything and report, change nothing. false: create every row, or none if any row fails. */
  dryRun: z.boolean().default(true),
});

/** One row after column mapping; codes are resolved to ids by the API. */
export const employeeImportRowSchema = z.object({
  employee_code: z.preprocess(blankToNull, employeeCodeField.nullable()).optional(),
  first_name: employeeFields.firstName,
  last_name: employeeFields.lastName,
  work_email: employeeFields.workEmail,
  phone: employeeFields.phone,
  date_of_joining: dateOnly,
  date_of_birth: optionalDate,
  gender: z
    .preprocess(
      (v) =>
        typeof v === 'string' ? (v.trim() === '' ? null : v.trim().toUpperCase().replace(/[\s-]/g, '_')) : v,
      z.enum(GENDERS).nullable(),
    )
    .optional(),
  company_code: z.string().trim().min(1, 'Enter the company code').toUpperCase(),
  branch_code: optionalText(30),
  department_code: optionalText(30),
  designation_code: optionalText(30),
  grade_code: optionalText(30),
  employment_type_code: optionalText(30),
  cost_centre_code: optionalText(30),
  manager_code: optionalText(30),
});
export type EmployeeImportRow = z.output<typeof employeeImportRowSchema>;
