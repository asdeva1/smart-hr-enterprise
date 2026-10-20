import { describe, expect, it } from 'vitest';
import { depreciation, wholeMonths } from './depreciation.js';

describe('wholeMonths', () => {
  it('counts a month once its day has been reached', () => {
    expect(wholeMonths('2026-01-15', '2026-02-14')).toBe(0);
    expect(wholeMonths('2026-01-15', '2026-02-15')).toBe(1);
    expect(wholeMonths('2025-12-31', '2026-02-28')).toBe(1);
    expect(wholeMonths('2024-03-10', '2026-03-10')).toBe(24);
  });
  it('is never negative', () => {
    expect(wholeMonths('2026-05-01', '2026-01-01')).toBe(0);
    expect(wholeMonths('2026-05-01', '2026-05-01')).toBe(0);
  });
});

describe('depreciation', () => {
  const base = { purchaseDate: '2025-01-01', cost: 60000, salvage: 6000, lifeMonths: 36 };
  it('spreads cost less resale value evenly', () => {
    const d = depreciation({ ...base, asOf: '2026-01-01' });
    expect(d.monthsElapsed).toBe(12);
    expect(d.monthlyCharge).toBe(1500);
    expect(d.accumulated).toBe(18000);
    expect(d.bookValue).toBe(42000);
    expect(d.fullyDepreciated).toBe(false);
  });
  it('stops at the resale value after the useful life', () => {
    const d = depreciation({ ...base, asOf: '2035-01-01' });
    expect(d.monthsElapsed).toBe(36);
    expect(d.bookValue).toBe(6000);
    expect(d.fullyDepreciated).toBe(true);
  });
  it('is the full cost before the first month is up', () => {
    expect(depreciation({ ...base, asOf: '2025-01-20' }).bookValue).toBe(60000);
  });
  it('stops when the asset is retired', () => {
    const d = depreciation({ ...base, asOf: '2026-06-01', retiredOn: '2025-07-01' });
    expect(d.monthsElapsed).toBe(6);
    expect(d.bookValue).toBe(51000);
  });
  it('rounds to the paisa without drifting', () => {
    const d = depreciation({
      purchaseDate: '2025-01-01',
      cost: 100,
      salvage: 0,
      lifeMonths: 3,
      asOf: '2025-02-01',
    });
    expect(d.accumulated).toBe(33.33);
    expect(
      depreciation({ purchaseDate: '2025-01-01', cost: 100, salvage: 0, lifeMonths: 3, asOf: '2025-04-01' })
        .bookValue,
    ).toBe(0);
  });
});
