import { z } from 'zod';

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export const emailField = z
  .string()
  .trim()
  .min(1, 'Enter your email address')
  .max(254, 'Email address is too long')
  .pipe(z.email('Enter a valid email address'));

/** Only the length check lives here; the API also applies the block list and email-name rule. */
export const newPasswordField = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`);

/** Sign-in accepts any non-empty password up to the max, so older passwords still work. */
const currentPasswordField = z
  .string()
  .min(1, 'Enter your password')
  .max(PASSWORD_MAX, 'Password is too long');

export const loginSchema = z.object({
  email: emailField,
  password: currentPasswordField,
});
export type LoginInput = z.infer<typeof loginSchema>;

export const totpCodeField = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app');

export const recoveryCodeField = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/, 'Enter a recovery code like ABCDE-FGHJK');

/** Second factor: exactly one of a TOTP code or a recovery code. */
export const mfaVerifySchema = z.union([
  z.object({ code: totpCodeField }).strict(),
  z.object({ recoveryCode: recoveryCodeField }).strict(),
]);
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

export const forgotPasswordSchema = z.object({ email: emailField });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: newPasswordField,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z.object({
  currentPassword: currentPasswordField,
  newPassword: newPasswordField,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const reauthenticateSchema = z.object({
  password: currentPasswordField,
  code: totpCodeField.optional(),
});
export type ReauthenticateInput = z.infer<typeof reauthenticateSchema>;

export const confirmTotpSchema = z.object({ code: totpCodeField });
export type ConfirmTotpInput = z.infer<typeof confirmTotpSchema>;

export const switchTenantSchema = z.object({ tenantId: z.uuid() });
export type SwitchTenantInput = z.infer<typeof switchTenantSchema>;

/** Browser-side check that the two password fields match; not needed by the API. */
export const newPasswordWithConfirmSchema = z
  .object({ newPassword: newPasswordField, confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
