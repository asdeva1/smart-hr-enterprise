import argon2 from 'argon2';

/**
 * argon2id parameters. Memory 19 MiB, 2 iterations, 1 lane is the OWASP Password Storage Cheat Sheet
 * baseline; we use 64 MiB / 3 iterations, which costs roughly 50–100 ms per hash on a server core.
 * Parameters are encoded in each hash, so they can be raised later without breaking existing hashes.
 */
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
} as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, HASH_OPTIONS);
}

/** Returns false (never throws) for a wrong password or a malformed hash. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** True when a stored hash uses weaker parameters than the current ones and should be rehashed on sign-in. */
export function needsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, HASH_OPTIONS);
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the same time as a real verification. Called when no user matches the email, so response
 * time does not reveal whether an account exists.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('dummy-password-for-timing-only');
  await verifyPassword(await dummyHash, password);
  return false;
}

/**
 * A short list of passwords that pass the length rule but are still among the most commonly breached.
 * The length rule does most of the work; this catches the obvious ones.
 */
const COMMON = new Set([
  'password1234',
  'password12345',
  'password123456',
  '123456789012',
  '1234567890123',
  'qwertyuiop12',
  'qwerty123456',
  'iloveyou1234',
  'welcome12345',
  'admin1234567',
  'letmein12345',
  'changeme1234',
  'passw0rd1234',
  'smarthr12345',
  'password@123',
  'Password@123',
  'Welcome@1234',
  'Admin@123456',
]);

export type PasswordProblem = 'TOO_SHORT' | 'TOO_LONG' | 'TOO_COMMON' | 'CONTAINS_EMAIL' | 'REPEATED';

/**
 * Policy follows NIST SP 800-63B: length over composition rules, a block list, no forced rotation.
 * Returns every problem found (empty array = acceptable).
 */
export function checkPasswordPolicy(password: string, context: { email?: string } = {}): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push('TOO_SHORT');
  if (password.length > PASSWORD_MAX_LENGTH) problems.push('TOO_LONG');
  if (COMMON.has(password) || COMMON.has(password.toLowerCase())) problems.push('TOO_COMMON');
  if (/^(.)\1+$/.test(password)) problems.push('REPEATED');
  const local = context.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && password.toLowerCase().includes(local)) problems.push('CONTAINS_EMAIL');
  return problems;
}

export const PASSWORD_PROBLEM_MESSAGES: Record<PasswordProblem, string> = {
  TOO_SHORT: `Use at least ${PASSWORD_MIN_LENGTH} characters`,
  TOO_LONG: `Use at most ${PASSWORD_MAX_LENGTH} characters`,
  TOO_COMMON: 'This password is too common',
  CONTAINS_EMAIL: 'Do not include your email name in the password',
  REPEATED: 'Do not repeat a single character',
};
