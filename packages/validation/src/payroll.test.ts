import { describe, expect, it } from 'vitest';
import { payrollSettingSchema, professionalTaxSchema, salarySchema } from './payroll.js';

describe('payroll input', () => {
  it('takes amounts with up to two decimals, including ones floating point gets wrong', () => {
    const id = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    const ok = (annualCtc: number) =>
      salarySchema.safeParse({
        effectiveFrom: '2026-04-01',
        annualCtc,
        lines: [{ componentId: id, monthly: 0.29 }],
      }).success;
    expect(ok(60_000 * 12 * 1.1)).toBe(true); // 792000.0000000001
    expect(ok(1234.56)).toBe(true);
    expect(ok(1234.567)).toBe(false);
    expect(ok(-1)).toBe(false);
  });

  it('wants professional-tax slabs in order and ending open', () => {
    const slabs = (s: { upTo: number | null; amount: number }[]) =>
      professionalTaxSchema.safeParse({ name: 'Karnataka', slabs: s }).success;
    expect(
      slabs([
        { upTo: 24_999, amount: 0 },
        { upTo: null, amount: 200 },
      ]),
    ).toBe(true);
    expect(slabs([{ upTo: 24_999, amount: 0 }])).toBe(false);
    expect(
      slabs([
        { upTo: 20_000, amount: 0 },
        { upTo: 10_000, amount: 150 },
        { upTo: null, amount: 200 },
      ]),
    ).toBe(false);
  });

  it('checks the TAN format', () => {
    const base = {
      pfEnabled: true,
      esiEnabled: true,
      labourCodeWages: true,
      pfEstablishmentId: '',
      esiEmployerCode: '',
    };
    expect(payrollSettingSchema.parse({ ...base, tan: 'blra12345e' }).tan).toBe('BLRA12345E');
    expect(payrollSettingSchema.safeParse({ ...base, tan: 'BLR12345E' }).success).toBe(false);
  });
});
