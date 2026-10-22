import { describe, expect, it } from 'vitest';
import { rolloverWindow } from './ai.service.js';

const d = (s: string) => new Date(`${s}T10:00:00Z`);

describe('rolloverWindow', () => {
  it('gives a newly enabled organisation just this month', () => {
    const w = rolloverWindow(d('2026-10-20'), d('2026-10-03'));
    expect(w.months).toBe(1);
    expect(w.start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('adds one month of unused tokens for each month lived, up to three', () => {
    expect(rolloverWindow(d('2026-10-20'), d('2026-09-15')).months).toBe(2);
    expect(rolloverWindow(d('2026-10-20'), d('2026-07-01')).months).toBe(4);
    const long = rolloverWindow(d('2026-10-20'), d('2025-01-01'));
    expect(long.months).toBe(4); // never more than this month plus three earlier ones
    expect(long.start.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('crosses a year end', () => {
    const w = rolloverWindow(d('2027-01-05'), d('2026-11-20'));
    expect(w.months).toBe(3);
    expect(w.start.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('treats an unknown enable date as this month only', () => {
    expect(rolloverWindow(d('2026-10-20'), null).months).toBe(1);
  });
});
