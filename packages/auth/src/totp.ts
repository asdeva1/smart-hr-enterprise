import { Secret, TOTP } from 'otpauth';

/** RFC 6238 defaults that every authenticator app supports. */
const PERIOD_SECONDS = 30;
const DIGITS = 6;
/** Accept one step either side, to absorb clock drift (±30 s). */
const WINDOW = 1;

export interface TotpEnrolment {
  /** Base32 secret, shown to the user as a fallback to the QR code. */
  secret: string;
  /** otpauth:// URI encoded into the QR code. */
  uri: string;
}

export function createTotpEnrolment(issuer: string, accountName: string): TotpEnrolment {
  const secret = new Secret({ size: 20 });
  const totp = new TOTP({
    issuer,
    label: accountName,
    algorithm: 'SHA1',
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret,
  });
  return { secret: secret.base32, uri: totp.toString() };
}

export interface TotpCheck {
  valid: boolean;
  /** The time step the code belongs to; store it to reject replays. */
  step?: number;
}

/**
 * Verifies a 6-digit code. `lastUsedStep` is the step of the last accepted code: a code from that step
 * or earlier is rejected, so an intercepted code cannot be replayed within its validity window.
 */
export function verifyTotp(
  base32Secret: string,
  code: string,
  lastUsedStep: number | null,
  now: number = Date.now(),
): TotpCheck {
  if (!/^\d{6}$/.test(code)) return { valid: false };
  const totp = new TOTP({
    algorithm: 'SHA1',
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret: Secret.fromBase32(base32Secret),
  });
  const delta = totp.validate({ token: code, timestamp: now, window: WINDOW });
  if (delta === null) return { valid: false };
  const step = Math.floor(now / 1000 / PERIOD_SECONDS) + delta;
  if (lastUsedStep !== null && step <= lastUsedStep) return { valid: false };
  return { valid: true, step };
}

/** Generates the code for a given time. Used by tests and nowhere in production code. */
export function generateTotpForTesting(base32Secret: string, now: number = Date.now()): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret: Secret.fromBase32(base32Secret),
  }).generate({
    timestamp: now,
  });
}
