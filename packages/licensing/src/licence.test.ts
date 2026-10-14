import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { resolveEntitlements } from '@smart-hr/entitlements';
import { describe, expect, it } from 'vitest';
import {
  decodeUnverified,
  exportPublicKey,
  licenceEntitlementInputs,
  licenceState,
  parsePublicKeys,
  signLicence,
  verifyLicence,
  type LicencePayload,
} from './licence.js';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const other = generateKeyPairSync('ed25519');
const ring = parsePublicKeys(`k1:${exportPublicKey(publicKey)}`);
const installation = randomUUID();

function payload(overrides: Partial<LicencePayload> = {}): LicencePayload {
  return {
    v: 1,
    licenceId: randomUUID(),
    keyId: 'k1',
    customer: { name: 'Acme Health' },
    deploymentModel: 'IN_HOUSE',
    plan: { code: 'ENTERPRISE', name: 'Enterprise' },
    features: ['hr.core', 'leave.basic', 'future.module'],
    limits: { 'users.max': 500, 'unknown.limit': 3 },
    supportLevel: 'PRIORITY',
    issuedAt: '2026-01-01T00:00:00.000Z',
    notBefore: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-01-01T00:00:00.000Z',
    graceDays: 30,
    maxOrganisations: 2,
    installationId: null,
    ...overrides,
  };
}

const at = (iso: string) => new Date(iso);

describe('signing and verification', () => {
  it('round-trips a licence signed with a listed key', () => {
    const p = payload();
    const result = verifyLicence(signLicence(p, privateKey), ring);
    expect(result).toEqual({ ok: true, payload: p });
  });

  it('refuses a licence whose payload was edited', () => {
    const token = signLicence(payload(), privateKey);
    const [prefix, body, sig] = token.split('.') as [string, string, string];
    const edited = JSON.parse(Buffer.from(body, 'base64url').toString()) as LicencePayload;
    edited.maxOrganisations = null;
    const forged = `${prefix}.${Buffer.from(JSON.stringify(edited)).toString('base64url')}.${sig}`;
    expect(verifyLicence(forged, ring)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('refuses a licence signed with a key that is not listed, and a key id swapped to a listed one', () => {
    expect(verifyLicence(signLicence(payload({ keyId: 'k9' }), other.privateKey), ring)).toEqual({
      ok: false,
      reason: 'UNKNOWN_KEY',
    });
    expect(verifyLicence(signLicence(payload(), other.privateKey), ring)).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('refuses malformed input and other versions without throwing', () => {
    expect(verifyLicence('', ring)).toEqual({ ok: false, reason: 'MALFORMED' });
    expect(verifyLicence('a.b', ring)).toEqual({ ok: false, reason: 'MALFORMED' });
    expect(verifyLicence('SHRL1.%%%.abc', ring)).toEqual({ ok: false, reason: 'MALFORMED' });
    const token = signLicence(payload(), privateKey);
    expect(verifyLicence(token.replace(/^SHRL1/, 'SHRL2'), ring)).toEqual({
      ok: false,
      reason: 'UNSUPPORTED_VERSION',
    });
  });

  it('will not sign an invalid payload', () => {
    expect(() => signLicence(payload({ expiresAt: '2025-01-01T00:00:00.000Z' }), privateKey)).toThrow();
  });

  it('accepts only Ed25519 public keys', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(() => parsePublicKeys(`r:${exportPublicKey(rsa.publicKey)}`)).toThrow(/not an Ed25519 key/);
    expect(() => parsePublicKeys('nocolon')).toThrow(/format/);
    expect(parsePublicKeys('').size).toBe(0);
  });
});

describe('licence state over time', () => {
  const p = payload();
  it.each([
    ['2025-12-31T00:00:00Z', 'NOT_YET_VALID'],
    ['2026-06-01T00:00:00Z', 'VALID'],
    ['2027-01-15T00:00:00Z', 'GRACE'],
    ['2027-02-01T00:00:00Z', 'EXPIRED'],
  ] as const)('%s is %s', (now, status) => {
    expect(licenceState(p, installation, at(now)).status).toBe(status);
  });

  it('applies only to the installation it names', () => {
    expect(
      licenceState(payload({ installationId: randomUUID() }), installation, at('2026-06-01T00:00:00Z'))
        .status,
    ).toBe('WRONG_INSTALLATION');
    expect(
      licenceState(payload({ installationId: installation }), installation, at('2026-06-01T00:00:00Z'))
        .status,
    ).toBe('VALID');
  });
});

describe('entitlements from a licence', () => {
  const resolve = (p: LicencePayload, now: string) => {
    const state = licenceState(p, installation, at(now));
    return resolveEntitlements({
      ...licenceEntitlementInputs(p, state),
      addons: [],
      overrides: [],
      now: at(now),
    });
  };

  it('grants licensed features and limits, ignoring codes this version does not know', () => {
    const e = resolve(payload(), '2026-06-01T00:00:00Z');
    expect(e.status).toBe('ACTIVE');
    expect(e.access).toBe('FULL');
    expect(e.features).toEqual(['hr.core', 'leave.basic']);
    expect(e.limits['users.max']).toBe(500);
    expect(e.limits).not.toHaveProperty('unknown.limit');
  });

  it('keeps working through grace, then becomes read-only but never hides data', () => {
    expect(resolve(payload(), '2027-01-15T00:00:00Z')).toMatchObject({ status: 'GRACE', access: 'FULL' });
    expect(resolve(payload(), '2027-02-01T00:00:00Z')).toMatchObject({
      status: 'EXPIRED',
      access: 'READ_ONLY',
    });
    expect(resolve(payload(), '2027-02-01T00:00:00Z').features).toContain('hr.core');
  });

  it('keeps an unverifiable licence readable but read-only', () => {
    const p = payload();
    const e = resolveEntitlements({
      ...licenceEntitlementInputs(decodeUnverified(signLicence(p, other.privateKey))!, null),
      addons: [],
      overrides: [],
      now: at('2026-06-01T00:00:00Z'),
    });
    expect(e).toMatchObject({ status: 'EXPIRED', access: 'READ_ONLY' });
    expect(e.features).toContain('hr.core');
    expect(decodeUnverified('garbage')).toBeNull();
  });

  it('makes a licence for another installation read-only', () => {
    expect(resolve(payload({ installationId: randomUUID() }), '2026-06-01T00:00:00Z')).toMatchObject({
      status: 'EXPIRED',
      access: 'READ_ONLY',
    });
  });
});
