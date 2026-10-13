import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random token, base64url. Used for session cookies, CSRF tokens and reset links. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * SHA-256 of a high-entropy token, hex. Tokens are random and long, so a fast hash is appropriate:
 * a database leak does not reveal usable tokens, and lookups stay indexable.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
