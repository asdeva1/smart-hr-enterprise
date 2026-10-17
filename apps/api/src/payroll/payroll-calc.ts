import {
  annualTax,
  ESI_RULES,
  monthsLeftInYear,
  PF_RULES,
  professionalTax,
  type PtSlab,
  type TaxRules,
} from './statutory-in.js';

/** Whole rupees. Payroll lines are rounded to the rupee; ESI rounds up, as the scheme requires. */
const round = (n: number) => Math.round(n);

export interface ComponentInput {
  code: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION';
  monthly: number;
  taxable: boolean;
  /** Counts as "wages" for provident fund (basic, dearness allowance, retaining allowance). */
  pfWage: boolean;
  /** Counts towards ESI wages. */
  esiWage: boolean;
  /** Reduced for days not paid (joining, leaving, loss of pay). */
  prorate: boolean;
}

export interface Adjustment {
  name: string;
  kind: 'EARNING' | 'DEDUCTION';
  amount: number;
  taxable: boolean;
}

export interface PayslipInput {
  year: number;
  month: number;
  /** Days of the month the person was employed (joining and leaving dates applied). */
  employedDays: number;
  lopDays: number;
  components: ComponentInput[];
  adjustments: Adjustment[];
  statutory: {
    pf: { enabled: boolean; onFullWages: boolean; labourCodeWages: boolean } | null;
    /** null = not covered this contribution period. */
    esi: { covered: boolean } | null;
    pt: PtSlab[] | null;
    tds: {
      rules: TaxRules;
      /** Taxable pay already paid this financial year (approved payslips), and tax already deducted. */
      ytdTaxable: number;
      ytdTds: number;
    } | null;
  };
}

export interface Line {
  code: string;
  name: string;
  amount: number;
}

export interface PayslipResult {
  daysInMonth: number;
  paidDays: number;
  earnings: Line[];
  deductions: Line[];
  employer: Line[];
  gross: number;
  totalDeductions: number;
  net: number;
  employerCost: number;
  pfWages: number;
  esiWages: number;
  taxableThisMonth: number;
  tds: {
    projectedAnnualTaxable: number;
    annualTax: number;
    deductedBefore: number;
    monthsLeft: number;
  } | null;
  /** Monthly ESI wages at the full rate, used to decide coverage at the start of a period. */
  fullMonthEsiWages: number;
  warnings: string[];
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** PF wages under the labour codes: if what is left out of wages is more than half of pay, the excess counts. */
export function pfWagesOf(gross: number, wageItems: number, labourCode: boolean): number {
  if (!labourCode) return wageItems;
  const excluded = gross - wageItems;
  return excluded > gross / 2 ? wageItems + (excluded - gross / 2) : wageItems;
}

export function calculatePayslip(input: PayslipInput): PayslipResult {
  const dim = daysInMonth(input.year, input.month);
  const paidDays = Math.max(0, Math.min(input.employedDays, dim) - input.lopDays);
  const factor = paidDays / dim;
  const warnings: string[] = [];

  const earnings: Line[] = [];
  const deductions: Line[] = [];
  let pfWageItems = 0;
  let esiWages = 0;
  let fullMonthEsiWages = 0;
  let taxable = 0;
  let recurringTaxableFull = 0;

  for (const c of input.components) {
    const amount = c.prorate ? round(c.monthly * factor) : paidDays > 0 ? c.monthly : 0;
    if (c.kind === 'DEDUCTION') {
      if (amount) deductions.push({ code: c.code, name: c.name, amount });
      continue;
    }
    if (!amount && !c.monthly) continue;
    earnings.push({ code: c.code, name: c.name, amount });
    if (c.pfWage) pfWageItems += amount;
    if (c.esiWage) {
      esiWages += amount;
      fullMonthEsiWages += c.monthly;
    }
    if (c.taxable) {
      taxable += amount;
      recurringTaxableFull += c.monthly;
    }
  }
  for (const a of input.adjustments) {
    if (a.kind === 'EARNING') {
      earnings.push({ code: 'ADJ', name: a.name, amount: round(a.amount) });
      if (a.taxable) taxable += round(a.amount);
    } else {
      deductions.push({ code: 'ADJ', name: a.name, amount: round(a.amount) });
    }
  }
  const gross = earnings.reduce((s, l) => s + l.amount, 0);
  const employer: Line[] = [];

  // Provident fund.
  let pfWages = 0;
  const pf = input.statutory.pf;
  if (pf?.enabled && gross > 0) {
    pfWages = round(pfWagesOf(gross, pfWageItems, pf.labourCodeWages));
    const capped = Math.min(pfWages, PF_RULES.wageCeiling);
    const contributory = pf.onFullWages ? pfWages : capped;
    const employee = round(contributory * PF_RULES.employeeRate);
    const pension = round(capped * PF_RULES.pensionRate);
    const employerTotal = round(contributory * PF_RULES.employerRate);
    deductions.push({ code: 'PF', name: 'Provident fund', amount: employee });
    employer.push({ code: 'EPF_ER', name: 'Provident fund (employer)', amount: employerTotal - pension });
    employer.push({ code: 'EPS', name: 'Pension scheme (employer)', amount: pension });
    employer.push({ code: 'EDLI', name: 'EDLI insurance', amount: round(capped * PF_RULES.edliRate) });
    employer.push({
      code: 'PF_ADMIN',
      name: 'PF administration',
      amount: round(capped * PF_RULES.adminRate),
    });
  }

  // ESI.
  if (input.statutory.esi?.covered && esiWages > 0) {
    deductions.push({ code: 'ESI', name: 'ESI', amount: Math.ceil(esiWages * ESI_RULES.employeeRate) });
    employer.push({
      code: 'ESI_ER',
      name: 'ESI (employer)',
      amount: Math.ceil(esiWages * ESI_RULES.employerRate),
    });
  }

  // Professional tax.
  if (input.statutory.pt && gross > 0) {
    const pt = professionalTax(gross, input.statutory.pt, input.month);
    if (pt) deductions.push({ code: 'PT', name: 'Professional tax', amount: pt });
  }

  // Income tax (TDS): the year's projected tax, less what's been deducted, spread over the months left.
  let tds: PayslipResult['tds'] = null;
  if (input.statutory.tds) {
    const { rules, ytdTaxable, ytdTds } = input.statutory.tds;
    const monthsLeft = monthsLeftInYear(input.month);
    const projected =
      ytdTaxable + taxable + recurringTaxableFull * (monthsLeft - 1) - rules.standardDeduction;
    const tax = annualTax(projected, rules);
    const amount = Math.max(0, round((tax - ytdTds) / monthsLeft));
    if (amount) deductions.push({ code: 'TDS', name: 'Income tax (TDS)', amount });
    tds = {
      projectedAnnualTaxable: Math.max(0, projected),
      annualTax: tax,
      deductedBefore: ytdTds,
      monthsLeft,
    };
  }

  let totalDeductions = deductions.reduce((s, l) => s + l.amount, 0);
  if (totalDeductions > gross) {
    warnings.push('Deductions are more than pay this month; check loss of pay and one-off deductions.');
  }
  const net = gross - totalDeductions;
  totalDeductions = gross - net;
  return {
    daysInMonth: dim,
    paidDays,
    earnings,
    deductions,
    employer,
    gross,
    totalDeductions,
    net,
    employerCost: gross + employer.reduce((s, l) => s + l.amount, 0),
    pfWages,
    esiWages,
    taxableThisMonth: taxable,
    tds,
    fullMonthEsiWages,
    warnings,
  };
}
