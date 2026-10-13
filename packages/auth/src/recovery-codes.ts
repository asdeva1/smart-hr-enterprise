import { randomInt } from 'node:crypto';
import { hashToken } from './tokens.js';

/** Unambiguous alphabet: no 0/O, 1/I/L. 10 characters from 31 symbols ≈ 49 bits per code. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const RECOVERY_CODE_COUNT = 10;

/** Codes are shown once as `XXXXX-XXXXX`; only their hashes are stored. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const chars = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

/** Accepts the code with or without the dash, in any case, with surrounding spaces. */
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

export function hashRecoveryCode(code: string): string {
  return hashToken(normalizeRecoveryCode(code));
}
