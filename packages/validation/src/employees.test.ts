import { describe, expect, it } from 'vitest';
import {
  createEmployeeSchema,
  dateOnly,
  employeeImportRowSchema,
  employeeLifecycleSchema,
  employeeSensitiveSchema,
  parseCsv,
  updateEmployeeSchema,
  verhoeffValid,
} from './employees.js';

/** Appends the Verhoeff check digit, to build valid sample Aadhaar numbers. */
function withCheckDigit(base: string): string {
  for (let digit = 0; digit <= 9; digit++) if (verhoeffValid(base + digit)) return base + digit;
  throw new Error('unreachable');
}

const company = '0196f3a1-7c00-7000-8000-000000000001';

describe('dates', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(dateOnly.safeParse('2026-02-28').success).toBe(true);
    expect(dateOnly.safeParse('2026-02-30').success).toBe(false);
    expect(dateOnly.safeParse('01/04/2026').success).toBe(false);
  });

  it('keeps birth before joining and probation after it', () => {
    const r = createEmployeeSchema.safeParse({
      firstName: 'Meera',
      lastName: 'Iyer',
      companyId: company,
      dateOfJoining: '2026-04-01',
      dateOfBirth: '2026-05-01',
      probationEndDate: '2026-03-01',
    });
    expect(r.error?.issues.map((i) => i.path[0]).sort()).toEqual(['dateOfBirth', 'probationEndDate']);
  });
});

describe('createEmployeeSchema', () => {
  it('treats empty optional fields as not set and upper-cases the code', () => {
    const v = createEmployeeSchema.parse({
      employeeCode: ' emp-7 ',
      firstName: ' Meera ',
      lastName: 'Iyer',
      companyId: company,
      dateOfJoining: '2026-04-01',
      branchId: '',
      workEmail: '',
      phone: '+91 98765 43210',
    });
    expect(v).toMatchObject({ employeeCode: 'EMP-7', firstName: 'Meera', branchId: null, workEmail: null });
  });

  it('rejects bad phone numbers', () => {
    const r = createEmployeeSchema.safeParse({
      firstName: 'A',
      lastName: 'B',
      companyId: company,
      dateOfJoining: '2026-04-01',
      phone: '12ab',
    });
    expect(r.success).toBe(false);
  });

  it('requires a version for updates', () => {
    expect(updateEmployeeSchema.safeParse({ firstName: 'X' }).success).toBe(false);
    expect(updateEmployeeSchema.safeParse({ version: 3, firstName: 'X' }).success).toBe(true);
  });
});

describe('employeeSensitiveSchema', () => {
  it('normalises and checks PAN, Aadhaar, IFSC and UAN', () => {
    const aadhaar = withCheckDigit('23412341234');
    const v = employeeSensitiveSchema.parse({
      pan: 'abcde 1234 f',
      aadhaar: `${aadhaar.slice(0, 4)} ${aadhaar.slice(4, 8)} ${aadhaar.slice(8)}`,
      bankAccount: '0012 3456 7890',
      bankIfsc: 'hdfc0001234',
      uan: '100200300400',
    });
    expect(v).toMatchObject({
      pan: 'ABCDE1234F',
      aadhaar,
      bankAccount: '001234567890',
      bankIfsc: 'HDFC0001234',
    });
  });

  it('catches an Aadhaar typo through its check digit', () => {
    const valid = withCheckDigit('23412341234');
    const typo = valid.slice(0, 11) + String((Number(valid[11]) + 1) % 10);
    const r = employeeSensitiveSchema.safeParse({ aadhaar: typo });
    expect(r.error?.issues[0]?.message).toMatch(/check digit/);
  });

  it('distinguishes leaving a field alone from clearing it', () => {
    expect(employeeSensitiveSchema.parse({})).toEqual({});
    expect(employeeSensitiveSchema.parse({ pan: '' })).toEqual({ pan: null });
  });

  it('rejects malformed values', () => {
    for (const bad of [
      { pan: 'ABCD1234F' },
      { bankIfsc: 'HDFC1001234' },
      { bankAccount: '12345' },
      { uan: '123' },
    ]) {
      expect(employeeSensitiveSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('employeeLifecycleSchema', () => {
  it('requires an exit reason to record an exit', () => {
    expect(
      employeeLifecycleSchema.safeParse({ action: 'exit', version: 1, exitedOn: '2026-05-01' }).success,
    ).toBe(false);
  });

  it('allows removing a manager', () => {
    const v = employeeLifecycleSchema.parse({
      action: 'change_manager',
      version: 2,
      effectiveDate: '2026-05-01',
      managerId: '',
    });
    expect(v).toMatchObject({ managerId: null });
  });
});

describe('parseCsv', () => {
  it('handles quotes, embedded commas and newlines, CRLF and a byte-order mark', () => {
    const text =
      '\uFEFFfirst_name,last_name,note\r\n"Rao, Asha",Rao,"line one\nline two"\r\nRavi,"Say ""hi""",\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ['first_name', 'last_name', 'note'],
      ['Rao, Asha', 'Rao', 'line one\nline two'],
      ['Ravi', 'Say "hi"', ''],
    ]);
  });

  it('refuses an unterminated quote', () => {
    expect(() => parseCsv('a,"b\n')).toThrow(/never closed/);
  });
});

describe('employeeImportRowSchema', () => {
  it('maps friendly gender spellings and upper-cases the company code', () => {
    const v = employeeImportRowSchema.parse({
      first_name: 'Meera',
      last_name: 'Iyer',
      date_of_joining: '2026-04-01',
      company_code: 'acme-in',
      gender: 'non-binary',
    });
    expect(v).toMatchObject({ company_code: 'ACME-IN', gender: 'NON_BINARY' });
  });
});
