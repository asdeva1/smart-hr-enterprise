import { describe, expect, it } from 'vitest';
import { withExplicitSslMode } from './ssl-mode.js';

describe('withExplicitSslMode', () => {
  it.each(['require', 'prefer', 'verify-ca'])('makes %s explicit verify-full', (mode) => {
    expect(withExplicitSslMode(`postgresql://u:p@h/db?sslmode=${mode}`)).toBe(
      'postgresql://u:p@h/db?sslmode=verify-full',
    );
    expect(withExplicitSslMode(`postgresql://u:p@h/db?a=1&sslmode=${mode}&b=2`)).toBe(
      'postgresql://u:p@h/db?a=1&sslmode=verify-full&b=2',
    );
  });

  it('leaves other modes and plain strings alone', () => {
    for (const url of [
      'postgresql://u:p@h/db',
      'postgresql://u:p@h/db?sslmode=disable',
      'postgresql://u:p@h/db?sslmode=verify-full',
      'postgresql://u:p@h/db?sslmode=requirement',
    ]) {
      expect(withExplicitSslMode(url)).toBe(url);
    }
  });
});
