/**
 * Indian statutory rules used by payroll, by financial year (April–March). These are law, not organisation
 * settings, so they live here, versioned, with where they come from. Check them against the official
 * notifications before each financial year and add the new year rather than editing an old one.
 *
 * Sources (checked October 2026):
 * - Income tax, new regime (default), FY 2025-26 onwards: Finance Act 2025; unchanged by Budget 2026 for
 *   FY 2026-27. Slabs 0–4 L nil, then 5% steps of 4 L to 30% above 24 L; standard deduction ₹75,000;
 *   section 87A rebate up to ₹60,000 for total income up to ₹12 L (with marginal relief); cess 4%.
 * - Provident fund: 12% employee, 12% employer of which 8.33% to the pension scheme on wages up to ₹15,000;
 *   EDLI 0.5% and administration 0.5% on capped wages. From 21 November 2025 (Code on Social Security)
 *   contributions above the ₹15,000 ceiling are voluntary, and "wages" exclude allowances only up to 50% of
 *   pay: anything excluded beyond half is counted as wages.
 * - ESI: 0.75% employee, 3.25% employer, for employees whose ESI wages are up to ₹21,000 a month at the start
 *   of a contribution period (April–September, October–March); coverage continues for that period.
 */

export interface TaxSlab {
  /** Upper bound of the slab (annual taxable income), or null for the top slab. */
  upTo: number | null;
  rate: number;
}

export interface TaxRules {
  financialYear: string;
  slabs: TaxSlab[];
  standardDeduction: number;
  rebate: { incomeUpTo: number; maxRebate: number };
  cess: number;
  /** Surcharge on tax by total income band (new regime caps it at 25%). */
  surcharge: { above: number; rate: number }[];
}

export const NEW_REGIME: Record<string, TaxRules> = {
  '2025-26': {
    financialYear: '2025-26',
    slabs: [
      { upTo: 400_000, rate: 0 },
      { upTo: 800_000, rate: 0.05 },
      { upTo: 1_200_000, rate: 0.1 },
      { upTo: 1_600_000, rate: 0.15 },
      { upTo: 2_000_000, rate: 0.2 },
      { upTo: 2_400_000, rate: 0.25 },
      { upTo: null, rate: 0.3 },
    ],
    standardDeduction: 75_000,
    rebate: { incomeUpTo: 1_200_000, maxRebate: 60_000 },
    cess: 0.04,
    surcharge: [
      { above: 5_000_000, rate: 0.1 },
      { above: 10_000_000, rate: 0.15 },
      { above: 20_000_000, rate: 0.25 },
    ],
  },
};
NEW_REGIME['2026-27'] = { ...NEW_REGIME['2025-26']!, financialYear: '2026-27' };

export const PF_RULES = {
  employeeRate: 0.12,
  employerRate: 0.12,
  pensionRate: 0.0833,
  edliRate: 0.005,
  adminRate: 0.005,
  wageCeiling: 15_000,
  /** Code on Social Security, in force from this date: the 50% wages rule. */
  labourCodeFrom: '2025-11-21',
} as const;

export const ESI_RULES = {
  employeeRate: 0.0075,
  employerRate: 0.0325,
  wageCeiling: 21_000,
} as const;

/** The financial year a month belongs to, e.g. 2026-10 → "2026-27". */
export function financialYearOf(year: number, month: number): string {
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Months left in the financial year, counting this one (April → 12, March → 1). */
export function monthsLeftInYear(month: number): number {
  return month >= 4 ? 16 - month : 4 - month;
}

/** The ESI contribution period a month falls in: April–September or October–March. */
export function esiPeriodOf(year: number, month: number): string {
  if (month >= 4 && month <= 9) return `${year}-04`;
  return month >= 10 ? `${year}-10` : `${year - 1}-10`;
}

export function taxRulesFor(financialYear: string): TaxRules {
  const rules = NEW_REGIME[financialYear];
  if (!rules) {
    throw new Error(`No income-tax rules for financial year ${financialYear}; add them to statutory-in.ts`);
  }
  return rules;
}

/** Tax before cess: slabs, the section 87A rebate (with marginal relief), and surcharge (with marginal relief). */
function taxBeforeCess(taxable: number, rules: TaxRules): number {
  let tax = 0;
  let lower = 0;
  for (const slab of rules.slabs) {
    const upper = slab.upTo ?? Infinity;
    if (taxable > lower) tax += (Math.min(taxable, upper) - lower) * slab.rate;
    lower = upper;
  }
  if (taxable <= rules.rebate.incomeUpTo) {
    tax = Math.max(0, tax - rules.rebate.maxRebate);
  } else {
    // Just above the rebate limit, tax can't exceed the income above the limit.
    tax = Math.min(tax, taxable - rules.rebate.incomeUpTo);
  }
  const band = [...rules.surcharge].reverse().find((s) => taxable > s.above);
  if (!band) return tax;
  // Crossing a surcharge threshold can't cost more than the income above it.
  const atThreshold = taxBeforeCess(band.above, rules);
  return Math.min(tax * (1 + band.rate), atThreshold + (taxable - band.above));
}

/** Tax on an annual taxable income under the new regime, cess included, to the rupee. */
export function annualTax(income: number, rules: TaxRules): number {
  const taxable = Math.max(0, Math.round(income));
  return Math.round(taxBeforeCess(taxable, rules) * (1 + rules.cess));
}

export interface PtSlab {
  /** Monthly gross up to this amount (inclusive), or null for the top slab. */
  upTo: number | null;
  amount: number;
  /** A different amount in February (some states collect the year's balance then). */
  february?: number;
}

/**
 * Starting professional-tax tables for a few states. States revise these; organisations can change them
 * under Payroll settings, and should check them against the state's current notification.
 */
export const DEFAULT_PT: Record<string, { name: string; slabs: PtSlab[] }> = {
  KA: {
    name: 'Karnataka',
    slabs: [
      { upTo: 24_999, amount: 0 },
      { upTo: null, amount: 200, february: 300 },
    ],
  },
  MH: {
    name: 'Maharashtra',
    slabs: [
      { upTo: 7_500, amount: 0 },
      { upTo: 10_000, amount: 175 },
      { upTo: null, amount: 200, february: 300 },
    ],
  },
  TG: {
    name: 'Telangana',
    slabs: [
      { upTo: 15_000, amount: 0 },
      { upTo: 20_000, amount: 150 },
      { upTo: null, amount: 200 },
    ],
  },
  WB: {
    name: 'West Bengal',
    slabs: [
      { upTo: 10_000, amount: 0 },
      { upTo: 15_000, amount: 110 },
      { upTo: 25_000, amount: 130 },
      { upTo: 40_000, amount: 150 },
      { upTo: null, amount: 200 },
    ],
  },
};

export function professionalTax(gross: number, slabs: PtSlab[], month: number): number {
  const slab = slabs.find((s) => s.upTo === null || gross <= s.upTo);
  if (!slab) return 0;
  return month === 2 && slab.february !== undefined ? slab.february : slab.amount;
}
