import { describe, expect, it } from 'vitest';
import { createLookupValueSchema, updateLookupValueSchema } from './master-data.js';
import { ORGANISATION_SETTINGS, parseSetting } from './settings.js';

describe('organisation settings', () => {
  it('has a valid default for every setting', () => {
    for (const [key, def] of Object.entries(ORGANISATION_SETTINGS)) {
      expect(def.schema.safeParse(def.default).success, key).toBe(true);
    }
  });

  it('normalises and rejects values', () => {
    expect(parseSetting('default_currency', ' usd ')).toEqual({ ok: true, value: 'USD' });
    expect(parseSetting('default_currency', 'RUPEES').ok).toBe(false);
    expect(parseSetting('timezone', 'Asia/Dubai')).toEqual({ ok: true, value: 'Asia/Dubai' });
    expect(parseSetting('timezone', 'Mars/Olympus')).toEqual({
      ok: false,
      message: 'Choose a time zone from the list',
    });
    expect(parseSetting('financial_year_start_month', 13).ok).toBe(false);
    expect(parseSetting('employee_code_prefix', 'emp')).toEqual({ ok: true, value: 'EMP' });
    expect(parseSetting('week_start', 'FRIDAY').ok).toBe(false);
  });
});

describe('master data values', () => {
  it('upper-cases codes and refuses odd characters', () => {
    expect(createLookupValueSchema.parse({ code: ' sr-eng ', name: 'Senior Engineer' })).toMatchObject({
      code: 'SR-ENG',
      sortOrder: 0,
    });
    expect(createLookupValueSchema.safeParse({ code: 'a b', name: 'Spaces' }).success).toBe(false);
  });

  it('needs at least one change and never accepts a new code', () => {
    expect(updateLookupValueSchema.safeParse({}).success).toBe(false);
    expect(updateLookupValueSchema.parse({ code: 'X', status: 'ARCHIVED' })).toEqual({ status: 'ARCHIVED' });
  });
});
