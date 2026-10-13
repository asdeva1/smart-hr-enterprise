export * from './password.js';
export * from './recovery-codes.js';
export * from './secret-box.js';
export * from './tokens.js';
export * from './totp.js';

/** Lower-cases and trims an email address for storage and lookup. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
