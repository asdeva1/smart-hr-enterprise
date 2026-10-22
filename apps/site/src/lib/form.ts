import type { ZodType } from 'zod';

/** Reads a form, validates it with the same schema the API uses, and returns data or per-field messages. */
export function readForm<T>(
  form: HTMLFormElement,
  schema: ZodType<T>,
): { data: T; errors: null } | { data: null; errors: Record<string, string> } {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of new FormData(form)) {
    if (typeof value === 'string' && value.trim() !== '') raw[key] = value;
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { data: parsed.data, errors: null };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? '');
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return { data: null, errors };
}
