import { describe, expect, it } from 'vitest';
import { amountInWords, computeSalesTotals, stateOfGstin } from './sales-calc.js';

describe('sales totals', () => {
  const lines = [
    { quantity: 1, rate: 120_000, discountPct: 0, gstRate: 18 },
    { quantity: 3, rate: 15_000, discountPct: 0, gstRate: 18 },
  ];
  it('splits tax into CGST and SGST within the state', () => {
    expect(computeSalesTotals(lines, true)).toMatchObject({
      subtotal: 165_000,
      cgst: 14_850,
      sgst: 14_850,
      igst: 0,
      total: 194_700,
    });
  });
  it('charges IGST to another state', () => {
    expect(computeSalesTotals(lines, false)).toMatchObject({ igst: 29_700, cgst: 0, total: 194_700 });
  });
  it('applies discounts before tax and keeps paise exact', () => {
    const t = computeSalesTotals([{ quantity: 3, rate: 333.33, discountPct: 10, gstRate: 5 }], true);
    expect(t.subtotal).toBe(899.99);
    expect(t.total).toBeCloseTo(t.subtotal + t.cgst + t.sgst, 2);
  });
});

describe('amount in words', () => {
  it('uses lakhs and crores', () => {
    expect(amountInWords(194_700)).toBe('One lakh ninety-four thousand seven hundred rupees only.');
    expect(amountInWords(12_50_00_000)).toBe('Twelve crore fifty lakh rupees only.');
    expect(amountInWords(1.5)).toBe('One rupees and fifty paise only.');
  });
});

describe('GSTIN', () => {
  it('gives the state code', () => {
    expect(stateOfGstin('27AAPFU0939F1ZV')).toBe('27');
    expect(stateOfGstin('nonsense')).toBeNull();
  });
});
