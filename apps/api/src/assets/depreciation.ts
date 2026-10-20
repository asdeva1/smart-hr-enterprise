/**
 * Straight-line depreciation, worked out whenever an asset is read rather than stored: the cost less the
 * resale value is spread evenly over the useful life, one whole month at a time, starting from the month
 * after purchase day-by-day (a month counts once its day-of-month has been reached). An asset stops
 * depreciating when it is retired. All money is handled in paise.
 */
export interface Depreciation {
  monthsElapsed: number;
  monthlyCharge: number;
  accumulated: number;
  bookValue: number;
  fullyDepreciated: boolean;
}

/** Whole months from `from` to `to` (both YYYY-MM-DD); 0 if `to` is not after `from`. */
export function wholeMonths(from: string, to: string): number {
  if (to <= from) return 0;
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return Math.max(0, months);
}

export function depreciation(input: {
  purchaseDate: string;
  cost: number;
  salvage: number;
  lifeMonths: number;
  asOf: string;
  retiredOn?: string | null;
}): Depreciation {
  const end = input.retiredOn && input.retiredOn < input.asOf ? input.retiredOn : input.asOf;
  const monthsElapsed = Math.min(wholeMonths(input.purchaseDate, end), input.lifeMonths);
  const cost = Math.round(input.cost * 100);
  const depreciable = cost - Math.round(input.salvage * 100);
  const accumulated =
    monthsElapsed >= input.lifeMonths
      ? depreciable
      : Math.round((depreciable * monthsElapsed) / input.lifeMonths);
  return {
    monthsElapsed,
    monthlyCharge: Math.round(depreciable / input.lifeMonths) / 100,
    accumulated: accumulated / 100,
    bookValue: (cost - accumulated) / 100,
    fullyDepreciated: monthsElapsed >= input.lifeMonths,
  };
}
