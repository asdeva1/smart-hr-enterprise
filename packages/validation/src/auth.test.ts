import { describe, expect, it } from 'vitest';
import { loginSchema, mfaVerifySchema, newPasswordWithConfirmSchema, resetPasswordSchema } from './auth.js';

describe('loginSchema', () => {
  it('trims the email and keeps the password exactly as typed', () => {
    expect(loginSchema.parse({ email: ' asha@acme.in ', password: ' spaced ' })).toEqual({
      email: 'asha@acme.in',
      password: ' spaced ',
    });
  });

  it('rejects a malformed email and an empty password', () => {
    const result = loginSchema.safeParse({ email: 'not-an-email', password: '' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path[0])).toEqual(['email', 'password']);
  });
});

describe('mfaVerifySchema', () => {
  it('accepts a TOTP code or a recovery code, not both', () => {
    expect(mfaVerifySchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(mfaVerifySchema.safeParse({ recoveryCode: 'ABCDE-FGHJK' }).success).toBe(true);
    expect(mfaVerifySchema.safeParse({ code: '123456', recoveryCode: 'ABCDE-FGHJK' }).success).toBe(false);
    expect(mfaVerifySchema.safeParse({ code: '12345' }).success).toBe(false);
  });
});

describe('password rules', () => {
  it('enforces the minimum length on new passwords', () => {
    expect(resetPasswordSchema.safeParse({ token: 'x'.repeat(43), newPassword: 'short' }).success).toBe(
      false,
    );
  });

  it('checks the confirmation matches', () => {
    const result = newPasswordWithConfirmSchema.safeParse({
      newPassword: 'a long enough passphrase',
      confirmPassword: 'a long enough passphrasE',
    });
    expect(result.error?.issues[0]?.path).toEqual(['confirmPassword']);
  });
});
