import { describe, expect, it } from 'vitest';
import { brandingSchema, contrastWithWhite, tenantLifecycleSchema, tenantSlug } from './onboarding.js';

describe('branding', () => {
  it('measures contrast against white like WCAG', () => {
    expect(contrastWithWhite('#000000')).toBeCloseTo(21, 0);
    expect(contrastWithWhite('#ffffff')).toBeCloseTo(1, 1);
  });

  it('accepts a dark brand colour and refuses one too light for white text', () => {
    expect(
      brandingSchema.safeParse({ brandName: 'Acme', brandColor: '#0E6B66', brandLogoUrl: '' }).data,
    ).toEqual({
      brandName: 'Acme',
      brandColor: '#0e6b66',
      brandLogoUrl: null,
    });
    const light = brandingSchema.safeParse({ brandName: null, brandColor: '#ffd700', brandLogoUrl: null });
    expect(light.success).toBe(false);
  });

  it('only allows https logo addresses', () => {
    expect(
      brandingSchema.safeParse({
        brandName: null,
        brandColor: null,
        brandLogoUrl: 'http://x.example/logo.png',
      }).success,
    ).toBe(false);
    expect(
      brandingSchema.safeParse({ brandName: null, brandColor: null, brandLogoUrl: 'javascript:alert(1)' })
        .success,
    ).toBe(false);
  });
});

describe('tenant lifecycle', () => {
  it('requires a reason to suspend and the slug to archive', () => {
    expect(tenantLifecycleSchema.safeParse({ action: 'suspend', reason: '' }).success).toBe(false);
    expect(tenantLifecycleSchema.safeParse({ action: 'archive', reason: 'Contract ended' }).success).toBe(
      false,
    );
  });

  it('normalises slugs', () => {
    expect(tenantSlug.parse(' Acme-Health ')).toBe('acme-health');
    expect(tenantSlug.safeParse('-bad').success).toBe(false);
  });
});
