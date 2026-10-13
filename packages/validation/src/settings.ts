import { z } from 'zod';

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

type Input =
  | { type: 'select'; options: readonly { value: string | number; label: string }[] }
  | { type: 'text'; placeholder?: string }
  | { type: 'timezone' };

interface SettingDef<S extends z.ZodType> {
  group: 'Locale' | 'Finance' | 'People';
  label: string;
  description: string;
  schema: S;
  default: z.output<S>;
  input: Input;
}

const def = <S extends z.ZodType>(d: SettingDef<S>) => d;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Organisation settings. Each key has a schema and a default, so a stored value is always valid and modules
 * never handle a missing one. Defaults suit an Indian organisation and are meant to be changed.
 * Statutory values (tax rates, contribution ceilings) are not settings: they are effective-dated rules (Phase 14).
 */
export const ORGANISATION_SETTINGS = {
  timezone: def({
    group: 'Locale',
    label: 'Time zone',
    description:
      'Used for dates, attendance days and scheduled jobs when a company has no time zone of its own.',
    schema: z.string().refine(isTimeZone, 'Choose a time zone from the list'),
    default: 'Asia/Kolkata',
    input: { type: 'timezone' },
  }),
  date_format: def({
    group: 'Locale',
    label: 'Date format',
    description: 'How dates are shown across Smart HR.',
    schema: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD MMM YYYY']),
    default: 'DD/MM/YYYY',
    input: {
      type: 'select',
      options: [
        { value: 'DD/MM/YYYY', label: '31/12/2026' },
        { value: 'MM/DD/YYYY', label: '12/31/2026' },
        { value: 'YYYY-MM-DD', label: '2026-12-31' },
        { value: 'DD MMM YYYY', label: '31 Dec 2026' },
      ],
    },
  }),
  week_start: def({
    group: 'Locale',
    label: 'First day of the week',
    description: 'For calendars, rosters and weekly reports.',
    schema: z.enum(['MONDAY', 'SUNDAY', 'SATURDAY']),
    default: 'MONDAY',
    input: {
      type: 'select',
      options: [
        { value: 'MONDAY', label: 'Monday' },
        { value: 'SUNDAY', label: 'Sunday' },
        { value: 'SATURDAY', label: 'Saturday' },
      ],
    },
  }),
  default_currency: def({
    group: 'Finance',
    label: 'Default currency',
    description:
      'For new companies and amounts entered without a company. Each company keeps its own base currency.',
    schema: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Use a three-letter ISO currency code, e.g. INR'),
    default: 'INR',
    input: { type: 'text', placeholder: 'INR' },
  }),
  financial_year_start_month: def({
    group: 'Finance',
    label: 'Financial year starts in',
    description: 'For leave years, budgets and reports. Accounting periods are set up in Finance.',
    schema: z.coerce.number().int().min(1).max(12),
    default: 4,
    input: { type: 'select', options: MONTHS.map((label, i) => ({ value: i + 1, label })) },
  }),
  employee_code_prefix: def({
    group: 'People',
    label: 'Employee number prefix',
    description: 'New employee numbers start with this, e.g. EMP-0042.',
    schema: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9]{0,9}$/, 'Use 1–10 letters or digits, starting with a letter'),
    default: 'EMP',
    input: { type: 'text', placeholder: 'EMP' },
  }),
} as const;

export type OrganisationSettingKey = keyof typeof ORGANISATION_SETTINGS;
export type OrganisationSettings = {
  [K in OrganisationSettingKey]: z.output<(typeof ORGANISATION_SETTINGS)[K]['schema']>;
};

export function isOrganisationSetting(key: string): key is OrganisationSettingKey {
  return Object.prototype.hasOwnProperty.call(ORGANISATION_SETTINGS, key);
}

/** Validates one value; returns the normalised value or the first problem. */
export function parseSetting(
  key: OrganisationSettingKey,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; message: string } {
  const result = ORGANISATION_SETTINGS[key].schema.safeParse(value);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, message: result.error.issues[0]?.message ?? 'Invalid value' };
}

/** Body of PUT /v1/tenant/configuration: any subset of settings. */
export const configurationUpdateSchema = z.object({
  values: z
    .record(z.string(), z.unknown())
    .refine((v) => Object.keys(v).length > 0, 'Change at least one setting'),
});
