/**
 * Leave arithmetic, free of the database: counting the days a request uses, pro-rating a year's quota, monthly
 * accrual and carrying forward. Amounts are whole or half days.
 */
import { addDays } from '../attendance/attendance-calc.js';

/** Rounds down to the nearest half day. */
export function floorHalf(days: number): number {
  return Math.floor(days * 2 + 1e-9) / 2;
}

export interface CountedDay {
  date: string;
  portion: 1 | 0.5;
}

/**
 * The days a request uses. Weekly offs and holidays inside the range are free unless the leave type counts
 * them ("sandwich" rules). A half-day request is half of its one day.
 */
export function countLeaveDays(input: {
  from: string;
  to: string;
  halfDay?: 'FIRST_HALF' | 'SECOND_HALF' | null;
  includeNonWorkingDays: boolean;
  isNonWorking: (date: string) => boolean;
}): { days: number; dates: CountedDay[] } {
  const dates: CountedDay[] = [];
  for (let date = input.from; date <= input.to; date = addDays(date, 1)) {
    if (!input.includeNonWorkingDays && input.isNonWorking(date)) continue;
    dates.push({ date, portion: input.halfDay ? 0.5 : 1 });
  }
  return { days: dates.reduce((n, d) => n + d.portion, 0), dates };
}

/** Months of a year someone is employed in (joining and leaving months count). */
function employedMonths(year: number, joinedOn: string, leftOn: string | null): number[] {
  const months: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const first = `${year}-${String(m).padStart(2, '0')}-01`;
    const last = addDays(m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, '0')}-01`, -1);
    if (joinedOn > last) continue;
    if (leftOn && leftOn < first) continue;
    months.push(m);
  }
  return months;
}

/**
 * A yearly grant: the whole quota for someone employed all year, otherwise the share of months they are
 * employed from joining, rounded down to a half day. Leaving later in the year doesn't reduce it here; final
 * settlement handles that.
 */
export function yearlyGrant(quota: number, year: number, joinedOn: string): number {
  if (Number(joinedOn.slice(0, 4)) > year) return 0;
  if (Number(joinedOn.slice(0, 4)) < year) return quota;
  const months = 12 - (Number(joinedOn.slice(5, 7)) - 1);
  return floorHalf((quota * months) / 12);
}

/**
 * Monthly credits for a year up to and including `throughMonth` (1–12). Each credit is the rounded-down running
 * total minus what was already credited, so twelve months always add up to the yearly quota and no month is
 * credited twice. Months with nothing to credit are left out.
 */
export function monthlyAccruals(input: {
  quota: number;
  year: number;
  throughMonth: number;
  joinedOn: string;
  leftOn: string | null;
}): { periodKey: string; days: number }[] {
  const months = employedMonths(input.year, input.joinedOn, input.leftOn).filter(
    (m) => m <= input.throughMonth,
  );
  const credits: { periodKey: string; days: number }[] = [];
  let credited = 0;
  months.forEach((m, i) => {
    const total = floorHalf((input.quota * (i + 1)) / 12);
    const days = total - credited;
    credited = total;
    if (days > 0) credits.push({ periodKey: `${input.year}-${String(m).padStart(2, '0')}`, days });
  });
  return credits;
}

/** Splits last year's unused balance into what carries forward and what lapses. */
export function carryForward(unused: number, maxDays: number): { carry: number; lapse: number } {
  if (unused <= 0) return { carry: 0, lapse: 0 };
  const carry = Math.min(floorHalf(unused), maxDays);
  return { carry, lapse: unused - carry };
}
