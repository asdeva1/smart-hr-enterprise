import { describe, expect, it } from 'vitest';
import {
  calculatePayslip,
  daysInMonth,
  pfWagesOf,
  type ComponentInput,
  type PayslipInput,
} from './payroll-calc.js';
import {
  annualTax,
  DEFAULT_PT,
  esiPeriodOf,
  financialYearOf,
  monthsLeftInYear,
  professionalTax,
  taxRulesFor,
} from './statutory-in.js';

const rules = taxRulesFor('2026-27');

const component = (code: string, monthly: number, extra: Partial<ComponentInput> = {}): ComponentInput => ({
  code,
  name: code,
  kind: 'EARNING',
  monthly,
  taxable: true,
  pfWage: code === 'BASIC',
  esiWage: true,
  prorate: true,
  ...extra,
});

const base = (over: Partial<PayslipInput> = {}): PayslipInput => ({
  year: 2026,
  month: 10,
  employedDays: 31,
  lopDays: 0,
  components: [component('BASIC', 30_000), component('HRA', 15_000), component('SPECIAL', 15_000)],
  adjustments: [],
  statutory: {
    pf: { enabled: true, onFullWages: false, labourCodeWages: true },
    esi: null,
    pt: DEFAULT_PT.KA!.slabs,
    tds: { rules, ytdTaxable: 0, ytdTds: 0 },
  },
  ...over,
});

describe('income tax, new regime', () => {
  it('follows the slabs, the ₹12 lakh rebate with marginal relief, and cess', () => {
    expect(annualTax(1_200_000, rules)).toBe(0);
    // ₹12.1 lakh: slab tax is ₹61,500, but marginal relief caps it at the ₹10,000 above the limit.
    expect(annualTax(1_210_000, rules)).toBe(10_400);
    // ₹16 lakh: 20,000 + 40,000 + 60,000 = 1,20,000, plus 4% cess.
    expect(annualTax(1_600_000, rules)).toBe(124_800);
    // ₹30 lakh: 3,00,000 up to 24 L + 30% of 6 L = 4,80,000, plus cess.
    expect(annualTax(3_000_000, rules)).toBe(499_200);
  });

  it('adds surcharge above ₹50 lakh with marginal relief', () => {
    const at50 = annualTax(5_000_000, rules);
    const just = annualTax(5_010_000, rules);
    // Ten thousand more income can't cost more than ten thousand (plus cess) in tax.
    expect(just - at50).toBeLessThanOrEqual(Math.round(10_000 * 1.04) + 1);
    expect(annualTax(7_000_000, rules)).toBe(Math.round((300_000 + 4_600_000 * 0.3) * 1.1 * 1.04));
  });

  it('knows the financial year and the months left in it', () => {
    expect(financialYearOf(2026, 10)).toBe('2026-27');
    expect(financialYearOf(2027, 3)).toBe('2026-27');
    expect(monthsLeftInYear(4)).toBe(12);
    expect(monthsLeftInYear(10)).toBe(6);
    expect(monthsLeftInYear(3)).toBe(1);
    expect(esiPeriodOf(2026, 9)).toBe('2026-04');
    expect(esiPeriodOf(2027, 2)).toBe('2026-10');
    expect(() => taxRulesFor('2031-32')).toThrow(/No income-tax rules/);
  });
});

describe('statutory deductions', () => {
  it('counts allowances above half of pay as PF wages (labour codes)', () => {
    expect(pfWagesOf(60_000, 20_000, true)).toBe(30_000);
    expect(pfWagesOf(60_000, 40_000, true)).toBe(40_000);
    expect(pfWagesOf(60_000, 20_000, false)).toBe(20_000);
  });

  it('caps PF at the ₹15,000 ceiling unless contributing on full wages', () => {
    const r = calculatePayslip(base());
    expect(r.deductions.find((d) => d.code === 'PF')?.amount).toBe(1_800);
    expect(r.employer.find((d) => d.code === 'EPS')?.amount).toBe(1_250);
    expect(r.employer.find((d) => d.code === 'EPF_ER')?.amount).toBe(550);
    const full = calculatePayslip(
      base({
        statutory: { ...base().statutory, pf: { enabled: true, onFullWages: true, labourCodeWages: true } },
      }),
    );
    expect(full.deductions.find((d) => d.code === 'PF')?.amount).toBe(3_600);
    // The pension share stays capped.
    expect(full.employer.find((d) => d.code === 'EPS')?.amount).toBe(1_250);
  });

  it('deducts ESI when covered, rounding up', () => {
    const r = calculatePayslip(
      base({
        components: [component('BASIC', 9_000), component('HRA', 4_500), component('SPECIAL', 4_501)],
        statutory: { ...base().statutory, esi: { covered: true } },
      }),
    );
    expect(r.esiWages).toBe(18_001);
    expect(r.deductions.find((d) => d.code === 'ESI')?.amount).toBe(136);
    expect(r.employer.find((d) => d.code === 'ESI_ER')?.amount).toBe(586);
  });

  it('takes professional tax by state slab, with the February amount', () => {
    expect(professionalTax(30_000, DEFAULT_PT.KA!.slabs, 10)).toBe(200);
    expect(professionalTax(30_000, DEFAULT_PT.KA!.slabs, 2)).toBe(300);
    expect(professionalTax(20_000, DEFAULT_PT.KA!.slabs, 10)).toBe(0);
    expect(professionalTax(9_000, DEFAULT_PT.MH!.slabs, 10)).toBe(175);
  });
});

describe('a month’s payslip', () => {
  it('spreads the year’s tax over the months left', () => {
    const r = calculatePayslip(base());
    // ₹60,000 a month from October: 6 × 60,000 − 75,000 = 2,85,000 projected, under the rebate limit.
    expect(r.tds?.annualTax).toBe(0);
    const earlier = calculatePayslip(
      base({ statutory: { ...base().statutory, tds: { rules, ytdTaxable: 360_000 * 3, ytdTds: 30_000 } } }),
    );
    // 10,80,000 earlier + 3,60,000 this half − 75,000 = 13,65,000 → 20,000 + 40,000 + 24,750 = 84,750, plus cess = 88,140.
    expect(earlier.tds?.annualTax).toBe(88_140);
    expect(earlier.deductions.find((d) => d.code === 'TDS')?.amount).toBe(Math.round((88_140 - 30_000) / 6));
  });

  it('prorates for loss of pay and joining mid-month, and adds one-off lines', () => {
    const r = calculatePayslip(
      base({
        employedDays: 16,
        lopDays: 1,
        adjustments: [
          { name: 'Joining bonus', kind: 'EARNING', amount: 5_000, taxable: true },
          { name: 'Laptop damage', kind: 'DEDUCTION', amount: 1_000, taxable: false },
        ],
      }),
    );
    expect(daysInMonth(2026, 10)).toBe(31);
    expect(r.paidDays).toBe(15);
    expect(r.earnings.find((e) => e.code === 'BASIC')?.amount).toBe(Math.round((30_000 * 15) / 31));
    expect(r.gross).toBe(Math.round((30_000 * 15) / 31) + Math.round((15_000 * 15) / 31) * 2 + 5_000);
    expect(r.deductions.map((d) => d.code)).toContain('ADJ');
    expect(r.net).toBe(r.gross - r.totalDeductions);
    expect(r.employerCost).toBeGreaterThan(r.gross);
  });

  it('pays nothing and deducts nothing for a month with no paid days', () => {
    const r = calculatePayslip(base({ employedDays: 31, lopDays: 31 }));
    expect(r.gross).toBe(0);
    expect(r.deductions.filter((d) => d.code !== 'TDS')).toEqual([]);
    expect(r.net).toBe(0);
  });

  it('warns when deductions are more than pay', () => {
    const r = calculatePayslip(
      base({
        lopDays: 30,
        adjustments: [{ name: 'Advance recovery', kind: 'DEDUCTION', amount: 50_000, taxable: false }],
      }),
    );
    expect(r.warnings).toHaveLength(1);
    expect(r.net).toBeLessThan(0);
  });
});
