import { describe, expect, it } from 'vitest';
import { formatAmount } from './approvals';

describe('formatAmount', () => {
  it('groups Indian-style without going through floating point', () => {
    expect(formatAmount('12345678.50', 'INR')).toBe('INR 1,23,45,678.50');
    // Beyond Number's exact range: still exact.
    expect(formatAmount('900719925474099312.99', null)).toBe('9,00,71,99,25,47,40,99,312.99');
  });

  it('pads and trims to two decimals and shows a dash for no amount', () => {
    expect(formatAmount('50000', 'INR')).toBe('INR 50,000.00');
    expect(formatAmount('7.5', null)).toBe('7.50');
    expect(formatAmount(null, 'INR')).toBe('—');
  });

  it('never throws on input that is not an amount', () => {
    expect(formatAmount('fifty', null)).toBe('fifty');
    expect(formatAmount('1e5', 'INR')).toBe('1e5');
  });
});
