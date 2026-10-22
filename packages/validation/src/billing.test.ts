import { describe, expect, it } from 'vitest';
import { minEmployeesFor } from './billing.js';

describe('minEmployeesFor', () => {
  it('knows each plan’s minimum', () => {
    expect([minEmployeesFor('LITE'), minEmployeesFor('PRO'), minEmployeesFor('PREMIUM')]).toEqual([
      10, 25, 50,
    ]);
    expect(minEmployeesFor('ENTERPRISE')).toBe(300);
  });
  it('has no minimum for other plans', () => {
    expect(minEmployeesFor('CUSTOM_X')).toBe(1);
  });
});
