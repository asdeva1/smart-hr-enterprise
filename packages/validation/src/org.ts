import { z } from 'zod';

/** Short identifier people type and see in reports, unique within the organisation. */
export const codeField = z
  .string()
  .trim()
  .min(2, 'Use at least 2 characters')
  .max(20, 'Use at most 20 characters')
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Use letters, digits, hyphens and underscores')
  .transform((v) => v.toUpperCase());

export const nameField = z.string().trim().min(2, 'Use at least 2 characters').max(200, 'Name is too long');

export const countryField = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, 'Use a 2-letter country code, e.g. IN')
  .transform((v) => v.toUpperCase());

export const currencyField = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, 'Use a 3-letter currency code, e.g. INR')
  .transform((v) => v.toUpperCase());

/** IANA time zone id, checked against the runtime's zone database. */
export const timezoneField = z
  .string()
  .trim()
  .min(1, 'Choose a time zone')
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Use a valid time zone, e.g. Asia/Kolkata');

export const recordStatusField = z.enum(['ACTIVE', 'ARCHIVED']);

/** Forms send '' for an empty optional choice; treat it as "not set". */
const emptyToNull = (v: unknown) => (v === '' ? null : v);

/** Optional reference that may be cleared: '' and null both mean none. */
export const optionalUuidField = z.preprocess(emptyToNull, z.uuid().nullable()).optional();

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const createCompanySchema = z.object({
  code: codeField,
  name: nameField,
  legalName: optionalText(300),
  country: countryField,
  baseCurrency: currencyField,
  timezone: timezoneField,
});
export type CreateCompanyInput = z.input<typeof createCompanySchema>;

export const updateCompanySchema = createCompanySchema
  .omit({ code: true })
  .partial()
  .extend({ status: recordStatusField.optional() });
export type UpdateCompanyInput = z.input<typeof updateCompanySchema>;

export const createBranchSchema = z.object({
  companyId: z.uuid('Choose a company'),
  code: codeField,
  name: nameField,
  city: optionalText(120),
  country: z.preprocess(emptyToNull, countryField.nullable()).optional(),
  timezone: z.preprocess(emptyToNull, timezoneField.nullable()).optional(),
});
export type CreateBranchInput = z.input<typeof createBranchSchema>;

export const updateBranchSchema = createBranchSchema
  .omit({ code: true, companyId: true })
  .partial()
  .extend({ status: recordStatusField.optional() });
export type UpdateBranchInput = z.input<typeof updateBranchSchema>;

export const createDepartmentSchema = z.object({
  companyId: z.uuid('Choose a company'),
  parentId: optionalUuidField,
  code: codeField,
  name: nameField,
});
export type CreateDepartmentInput = z.input<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z.object({
  name: nameField.optional(),
  parentId: optionalUuidField,
  status: recordStatusField.optional(),
});
export type UpdateDepartmentInput = z.input<typeof updateDepartmentSchema>;

export const orgListQuerySchema = z.object({
  companyId: z.uuid().optional(),
  status: recordStatusField.optional(),
});
