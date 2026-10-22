import { describe, expect, it } from 'vitest';
import { emailDomain, isFreeEmailDomain } from './work-email.js';

describe('work email check', () => {
  it('refuses consumer and throwaway providers, in any letter case', () => {
    for (const address of [
      'a@gmail.com',
      'a@GMAIL.com',
      'a@yahoo.co.in',
      'a@outlook.com',
      'a@mailinator.com',
    ]) {
      expect(isFreeEmailDomain(address)).toBe(true);
    }
  });

  it('allows company domains and subdomains of company domains', () => {
    for (const address of ['a@smartcluestech.com', 'a@mail.smartcluestech.com', 'a@acme.co.in']) {
      expect(isFreeEmailDomain(address)).toBe(false);
    }
  });

  it('does not treat a lookalike as a free provider', () => {
    expect(isFreeEmailDomain('a@notgmail.com')).toBe(false);
    expect(isFreeEmailDomain('gmail.com@acme.com')).toBe(false);
  });

  it('reads the domain after the last @', () => {
    expect(emailDomain('a@b@Example.COM')).toBe('example.com');
    expect(emailDomain('nope')).toBe('');
  });
});
