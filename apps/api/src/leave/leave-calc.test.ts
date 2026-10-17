import { describe, expect, it } from 'vitest';
import { carryForward, countLeaveDays, floorHalf, monthlyAccruals, yearlyGrant } from './leave-calc.js';

const sundaysOff =
  (holidays: string[] = []) =>
  (date: string) =>
    new Date(`${date}T00:00:00Z`).getUTCDay() === 0 || holidays.includes(date);

describe('counting the days a request uses', () => {
  it('skips weekly offs and holidays unless the type counts them', () => {
    // Thu 2026-10-15 to Tue 2026-10-20, with Sunday off and a holiday on Tuesday.
    const range = { from: '2026-10-15', to: '2026-10-20', isNonWorking: sundaysOff(['2026-10-20']) };
    expect(countLeaveDays({ ...range, includeNonWorkingDays: false }).days).toBe(4);
    expect(countLeaveDays({ ...range, includeNonWorkingDays: true }).days).toBe(6);
  });

  it('counts a half day as half', () => {
    const r = countLeaveDays({
      from: '2026-10-15',
      to: '2026-10-15',
      halfDay: 'SECOND_HALF',
      includeNonWorkingDays: false,
      isNonWorking: sundaysOff(),
    });
    expect(r).toEqual({ days: 0.5, dates: [{ date: '2026-10-15', portion: 0.5 }] });
  });

  it('uses no days for a range that is all non-working', () => {
    expect(
      countLeaveDays({
        from: '2026-10-18',
        to: '2026-10-18',
        includeNonWorkingDays: false,
        isNonWorking: sundaysOff(),
      }).days,
    ).toBe(0);
  });
});

describe('quota', () => {
  it('rounds down to half days', () => {
    expect(floorHalf(1.74)).toBe(1.5);
    expect(floorHalf(2)).toBe(2);
    expect(floorHalf(0.49)).toBe(0);
  });

  it('pro-rates a yearly grant by the months from joining', () => {
    expect(yearlyGrant(12, 2026, '2020-06-01')).toBe(12);
    expect(yearlyGrant(12, 2026, '2026-07-15')).toBe(6); // July to December
    expect(yearlyGrant(18, 2026, '2026-10-01')).toBe(4.5);
    expect(yearlyGrant(12, 2026, '2027-01-01')).toBe(0);
  });

  it('accrues monthly without drift, from the joining month, and never past leaving', () => {
    const all = monthlyAccruals({
      quota: 15,
      year: 2026,
      throughMonth: 12,
      joinedOn: '2020-01-01',
      leftOn: null,
    });
    expect(all.reduce((n, c) => n + c.days, 0)).toBe(15);
    expect(new Set(all.map((c) => c.periodKey)).size).toBe(all.length);
    const soFar = monthlyAccruals({
      quota: 12,
      year: 2026,
      throughMonth: 3,
      joinedOn: '2020-01-01',
      leftOn: null,
    });
    expect(soFar).toEqual([
      { periodKey: '2026-01', days: 1 },
      { periodKey: '2026-02', days: 1 },
      { periodKey: '2026-03', days: 1 },
    ]);
    const joiner = monthlyAccruals({
      quota: 12,
      year: 2026,
      throughMonth: 12,
      joinedOn: '2026-11-20',
      leftOn: null,
    });
    expect(joiner.map((c) => c.periodKey)).toEqual(['2026-11', '2026-12']);
    const leaver = monthlyAccruals({
      quota: 12,
      year: 2026,
      throughMonth: 12,
      joinedOn: '2020-01-01',
      leftOn: '2026-02-10',
    });
    expect(leaver.map((c) => c.periodKey)).toEqual(['2026-01', '2026-02']);
  });

  it('carries forward up to the limit and lapses the rest', () => {
    expect(carryForward(7.5, 5)).toEqual({ carry: 5, lapse: 2.5 });
    expect(carryForward(3, 5)).toEqual({ carry: 3, lapse: 0 });
    expect(carryForward(-2, 5)).toEqual({ carry: 0, lapse: 0 });
  });
});
