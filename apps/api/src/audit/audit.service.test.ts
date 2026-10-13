import { describe, expect, it } from 'vitest';
import { emailFingerprint, sanitizeMetadata } from './audit.service.js';

describe('sanitizeMetadata', () => {
  it('drops credential-like keys at any depth', () => {
    expect(
      sanitizeMetadata({
        reason: 'bad_password',
        password: 'hunter2',
        nested: { resetToken: 'abc', recoveryCode: 'X', mfaSecret: 's', ok: 1 },
        headers: { authorization: 'Bearer x', cookie: 'shr_session=y' },
      }),
    ).toEqual({ reason: 'bad_password', nested: { ok: 1 }, headers: {} });
  });

  it('caps string length', () => {
    expect((sanitizeMetadata({ note: 'x'.repeat(1000) }) as { note: string }).note).toHaveLength(500);
  });
});

describe('emailFingerprint', () => {
  it('is stable and does not contain the email', () => {
    const a = emailFingerprint('asha@acme.in');
    expect(a).toBe(emailFingerprint('asha@acme.in'));
    expect(a).not.toContain('asha');
    expect(a).toHaveLength(16);
  });
});
