import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatPrice, loadPlans, priceFor, type PublicPlan } from './plans';

const plan: PublicPlan = {
  code: 'PRO',
  name: 'Pro',
  description: null,
  trialDays: 14,
  supportLevel: 'STANDARD',
  modules: [],
  limits: [],
  prices: [
    { currency: 'INR', billingPeriod: 'MONTHLY', pricingModel: 'PER_EMPLOYEE', amount: '99.5' },
    { currency: 'USD', billingPeriod: 'MONTHLY', pricingModel: 'PER_EMPLOYEE', amount: '2' },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.API_PROXY_TARGET;
});

describe('plan prices', () => {
  it('shows rupees with Indian grouping and the unit', () => {
    expect(formatPrice('12999', 'FLAT', 'ANNUAL')).toBe('₹12,999 flat / year');
    expect(formatPrice('99.5', 'PER_EMPLOYEE', 'MONTHLY')).toBe('₹99.5 per employee / month');
  });

  it('picks only the rupee price for the period', () => {
    expect(priceFor(plan, 'MONTHLY')?.amount).toBe('99.5');
    expect(priceFor(plan, 'ANNUAL')).toBeNull();
  });
});

describe('loadPlans', () => {
  it('returns null (contact us) when no API is configured', async () => {
    expect(await loadPlans()).toBeNull();
  });

  it('returns null when the API is down or answers something unexpected', async () => {
    process.env.API_PROXY_TARGET = 'https://api.example.test';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    expect(await loadPlans()).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ nope: 1 }))));
    expect(await loadPlans()).toBeNull();
  });

  it('parses a valid answer', async () => {
    process.env.API_PROXY_TARGET = 'https://api.example.test/';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ plans: [plan] }))));
    expect((await loadPlans())?.[0]?.code).toBe('PRO');
  });
});
