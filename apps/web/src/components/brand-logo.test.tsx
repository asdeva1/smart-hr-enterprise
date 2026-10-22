import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandLogo } from './brand-logo';

describe('BrandLogo', () => {
  it('shows the approved logo with an accessible name', () => {
    render(<BrandLogo />);
    const img = screen.getByRole('img', { name: /SmartHRMS/ });
    expect(img.getAttribute('src')).toContain('smarthrms-logo.png');
  });
});
