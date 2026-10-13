import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  checkPasswordPolicy,
  createTotpEnrolment,
  generateRecoveryCodes,
  generateToken,
  generateTotpForTesting,
  hashPassword,
  hashRecoveryCode,
  hashToken,
  needsRehash,
  normalizeEmail,
  safeEqual,
  SecretBox,
  verifyAgainstDummy,
  verifyPassword,
  verifyTotp,
} from './index.js';

describe('password hashing', () => {
  it('produces argon2id hashes that verify only the right password', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^\$argon2id\$v=19\$/);
    const params = hash.split('$')[3]!.split(',').sort();
    expect(params).toEqual(['m=65536', 'p=1', 't=3']);
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse batterY')).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same password here')).not.toBe(await hashPassword('same password here'));
  });

  it('treats a malformed hash as a failed verification, not a crash', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });

  it('flags hashes made with weaker parameters for rehashing', async () => {
    expect(needsRehash(await hashPassword('another password'))).toBe(false);
    expect(needsRehash('$argon2id$v=19$m=4096,t=1,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNo')).toBe(true);
  });

  it('spends real hashing time when no account exists', async () => {
    const started = performance.now();
    expect(await verifyAgainstDummy('whatever password')).toBe(false);
    expect(performance.now() - started).toBeGreaterThan(5);
  });
});

describe('password policy', () => {
  it('accepts a long passphrase', () => {
    expect(checkPasswordPolicy('river kettle orbit lamp', { email: 'asha@acme.in' })).toEqual([]);
  });

  it('reports every problem', () => {
    expect(checkPasswordPolicy('short')).toEqual(['TOO_SHORT']);
    expect(checkPasswordPolicy('x'.repeat(129))).toEqual(['TOO_LONG', 'REPEATED']);
    expect(checkPasswordPolicy('Password@123')).toEqual(['TOO_COMMON']);
    expect(checkPasswordPolicy('ashokumar-secret-2026', { email: 'ashokumar@acme.in' })).toEqual([
      'CONTAINS_EMAIL',
    ]);
  });
});

describe('tokens', () => {
  it('are long, random and URL-safe', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(token);
  });

  it('hash deterministically to hex SHA-256', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('compare in constant time without throwing on length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('SecretBox', () => {
  const key = randomBytes(32).toString('base64');
  const box = new SecretBox({ k1: key }, 'k1');

  it('round-trips a secret bound to its owner', () => {
    const sealed = box.encrypt('JBSWY3DPEHPK3PXP', 'user-1');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.decrypt(sealed, 'user-1')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('refuses a ciphertext moved to another user', () => {
    expect(() => box.decrypt(box.encrypt('secret', 'user-1'), 'user-2')).toThrow();
  });

  it('detects tampering', () => {
    const parts = box.encrypt('secret', 'user-1').split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => box.decrypt(parts.join('.'), 'user-1')).toThrow();
  });

  it('decrypts with an older key after rotation', () => {
    const sealedWithOld = box.encrypt('secret', 'u');
    const rotated = new SecretBox({ k1: key, k2: randomBytes(32).toString('base64') }, 'k2');
    expect(rotated.decrypt(sealedWithOld, 'u')).toBe('secret');
    expect(rotated.encrypt('secret', 'u')).toMatch(/^v1\.k2\./);
  });

  it('rejects keys of the wrong size', () => {
    expect(() => new SecretBox({ k1: randomBytes(16).toString('base64') }, 'k1')).toThrow(/32 bytes/);
  });
});

describe('TOTP', () => {
  // RFC 6238 Appendix B, SHA-1, secret "12345678901234567890", truncated to 6 digits.
  const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // gitleaks:allow — public RFC test vector
  it.each([
    [59, '287082'],
    [1_111_111_109, '081804'],
    [1_234_567_890, '005924'],
    [2_000_000_000, '279037'],
  ])('matches RFC 6238 at T=%i', (seconds, code) => {
    expect(generateTotpForTesting(rfcSecret, seconds * 1000)).toBe(code);
    expect(verifyTotp(rfcSecret, code, null, seconds * 1000).valid).toBe(true);
  });

  it('accepts one step of clock drift and no more', () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(rfcSecret, generateTotpForTesting(rfcSecret, now - 30_000), null, now).valid).toBe(
      true,
    );
    expect(verifyTotp(rfcSecret, generateTotpForTesting(rfcSecret, now - 90_000), null, now).valid).toBe(
      false,
    );
  });

  it('rejects a replayed code', () => {
    const now = 1_700_000_000_000;
    const code = generateTotpForTesting(rfcSecret, now);
    const first = verifyTotp(rfcSecret, code, null, now);
    expect(first.valid).toBe(true);
    expect(verifyTotp(rfcSecret, code, first.step!, now + 5_000).valid).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(verifyTotp(rfcSecret, '12345', null).valid).toBe(false);
    expect(verifyTotp(rfcSecret, 'abcdef', null).valid).toBe(false);
  });

  it('creates enrolments an authenticator app can scan', () => {
    const { secret, uri } = createTotpEnrolment('Smart HR', 'asha@acme.in');
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(uri).toMatch(/^otpauth:\/\/totp\/Smart%20HR:asha%40acme\.in\?/);
    expect(uri).toContain(`secret=${secret}`);
  });
});

describe('recovery codes', () => {
  it('generates ten distinct, readable codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
  });

  it('hash the same however the user types them', () => {
    expect(hashRecoveryCode('abcde-fghjk')).toBe(hashRecoveryCode(' ABCDEFGHJK '));
  });
});

describe('normalizeEmail', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('  Asha.Rao@ACME.in ')).toBe('asha.rao@acme.in');
  });
});
