import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import {
  isFeature,
  isLimitKey,
  SUPPORT_LEVELS,
  type Feature,
  type Limits,
  type PlanState,
  type SubscriptionState,
} from '@smart-hr/entitlements';
import { z } from 'zod';

/**
 * Signed licences for in-house installations, verified offline with Ed25519.
 *
 * Format: `SHRL1.<base64url(JSON payload)>.<base64url(signature)>`. The signature covers the bytes of
 * `SHRL1.<payload>`, so neither the version prefix nor the payload can be changed without the private key.
 * Only public keys ever reach an installation; the issuing key stays with Smartclues.
 */
export const LICENCE_PREFIX = 'SHRL1';

const isoDate = z.iso.datetime({ offset: true });

export const licencePayloadSchema = z
  .object({
    v: z.literal(1),
    licenceId: z.uuid(),
    keyId: z.string().regex(/^[a-z0-9-]{1,32}$/),
    customer: z.object({ name: z.string().trim().min(1).max(160) }),
    deploymentModel: z.enum(['IN_HOUSE']),
    plan: z.object({
      code: z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/),
      name: z.string().trim().min(1).max(80),
    }),
    features: z.array(z.string()).max(200),
    limits: z.record(z.string(), z.number().int().min(0).nullable()),
    supportLevel: z.enum(SUPPORT_LEVELS),
    issuedAt: isoDate,
    notBefore: isoDate,
    expiresAt: isoDate,
    /** Days after expiry during which everything keeps working, before paid modules become read-only. */
    graceDays: z.number().int().min(0).max(90),
    /** How many organisations this installation may hold; null = unlimited. */
    maxOrganisations: z.number().int().min(1).nullable(),
    /** Binds the licence to one installation; null = any installation of this customer. */
    installationId: z
      .string()
      .regex(/^[0-9a-f-]{36}$/)
      .nullable(),
  })
  .refine((p) => new Date(p.notBefore) < new Date(p.expiresAt), {
    path: ['expiresAt'],
    message: 'must be after notBefore',
  });

export type LicencePayload = z.infer<typeof licencePayloadSchema>;

export type VerifyFailure =
  'MALFORMED' | 'UNSUPPORTED_VERSION' | 'UNKNOWN_KEY' | 'BAD_SIGNATURE' | 'INVALID_PAYLOAD';

export type VerifyResult = { ok: true; payload: LicencePayload } | { ok: false; reason: VerifyFailure };

/** Public keys by key id. Several may be listed so licences signed with an older key keep working after rotation. */
export type PublicKeyRing = ReadonlyMap<string, KeyObject>;

const b64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

/** Parses `id:base64(SPKI DER)` pairs, comma-separated, into a key ring. Throws on anything that isn't an Ed25519 key. */
export function parsePublicKeys(value: string | undefined): PublicKeyRing {
  const ring = new Map<string, KeyObject>();
  for (const pair of (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const separator = pair.indexOf(':');
    const id = pair.slice(0, separator).trim();
    const der = pair.slice(separator + 1).trim();
    if (separator < 1 || !der) throw new Error('Use the format keyId:base64key,keyId2:base64key');
    const key = createPublicKey({ key: Buffer.from(der, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error(`Licence key ${id} is not an Ed25519 key`);
    ring.set(id, key);
  }
  return ring;
}

/** The public half of a key, in the form `parsePublicKeys` reads. Safe to publish. */
export function exportPublicKey(key: KeyObject): string {
  const pub = key.type === 'public' ? key : createPublicKey(key);
  return pub.export({ format: 'der', type: 'spki' }).toString('base64');
}

export function loadPrivateKey(pem: string): KeyObject {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('The licence signing key must be an Ed25519 key');
  return key;
}

/** Signs a licence. Only used by the issuing tool and tests; installations never hold a private key. */
export function signLicence(payload: LicencePayload, privateKey: KeyObject): string {
  const valid = licencePayloadSchema.parse(payload);
  const body = `${LICENCE_PREFIX}.${b64url(JSON.stringify(valid))}`;
  return `${body}.${b64url(sign(null, Buffer.from(body), privateKey))}`;
}

/** Verifies the signature and shape of a licence. Never throws; says why a licence was refused. */
export function verifyLicence(token: string, keys: PublicKeyRing): VerifyResult {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts.some((p) => !p)) return { ok: false, reason: 'MALFORMED' };
  const [prefix, payloadPart, signaturePart] = parts as [string, string, string];
  if (prefix !== LICENCE_PREFIX) return { ok: false, reason: 'UNSUPPORTED_VERSION' };

  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }
  const keyId = raw && typeof raw === 'object' && 'keyId' in raw ? raw.keyId : undefined;
  const key = typeof keyId === 'string' ? keys.get(keyId) : undefined;
  if (!key) return { ok: false, reason: 'UNKNOWN_KEY' };

  const signature = Buffer.from(signaturePart, 'base64url');
  if (!verify(null, Buffer.from(`${prefix}.${payloadPart}`), key, signature)) {
    return { ok: false, reason: 'BAD_SIGNATURE' };
  }
  const parsed = licencePayloadSchema.safeParse(raw);
  return parsed.success ? { ok: true, payload: parsed.data } : { ok: false, reason: 'INVALID_PAYLOAD' };
}

export type LicenceStatus = 'VALID' | 'NOT_YET_VALID' | 'GRACE' | 'EXPIRED' | 'WRONG_INSTALLATION';

export interface LicenceState {
  status: LicenceStatus;
  expiresAt: string;
  /** When paid modules become read-only, while in grace. */
  graceEndsAt: string | null;
  /** Whole days until expiry (negative once expired). */
  daysLeft: number;
}

const DAY = 86_400_000;

export function licenceState(
  payload: LicencePayload,
  installationId: string,
  now = new Date(),
): LicenceState {
  const expires = new Date(payload.expiresAt);
  const graceEnds = new Date(expires.getTime() + payload.graceDays * DAY);
  const daysLeft = Math.floor((expires.getTime() - now.getTime()) / DAY);
  const base = { expiresAt: expires.toISOString(), daysLeft };
  if (payload.installationId !== null && payload.installationId !== installationId) {
    return { ...base, status: 'WRONG_INSTALLATION', graceEndsAt: null };
  }
  if (now < new Date(payload.notBefore)) return { ...base, status: 'NOT_YET_VALID', graceEndsAt: null };
  if (now < expires) return { ...base, status: 'VALID', graceEndsAt: null };
  if (now < graceEnds) return { ...base, status: 'GRACE', graceEndsAt: graceEnds.toISOString() };
  return { ...base, status: 'EXPIRED', graceEndsAt: null };
}

/** Licensed features, keeping only codes this version knows (a newer licence may name newer modules). */
export function licensedFeatures(payload: LicencePayload): Feature[] {
  return payload.features.filter(isFeature);
}

export function licensedLimits(payload: LicencePayload): Limits {
  const limits: Limits = {};
  for (const [key, value] of Object.entries(payload.limits)) if (isLimitKey(key)) limits[key] = value;
  return limits;
}

/**
 * Reads a licence's payload without checking its signature. Only for keeping data readable when a stored
 * licence can no longer be verified (for example after a key was withdrawn): the result is used read-only.
 */
export function decodeUnverified(token: string): LicencePayload | null {
  const part = token.trim().split('.')[1];
  if (!part) return null;
  try {
    const parsed = licencePayloadSchema.safeParse(
      JSON.parse(Buffer.from(part, 'base64url').toString('utf8')),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * What the entitlement resolver should see for an installation licence. `state` is null when the licence
 * could not be verified. A licence that doesn't apply here (unverifiable, wrong installation or not yet
 * valid) still lists its modules but read-only: data is never hidden because of a licence problem.
 */
export function licenceEntitlementInputs(
  payload: LicencePayload,
  state: LicenceState | null,
): { plan: PlanState; subscription: SubscriptionState } {
  const usable = state?.status === 'VALID' || state?.status === 'GRACE' || state?.status === 'EXPIRED';
  return {
    plan: {
      code: payload.plan.code,
      name: payload.plan.name,
      version: 0,
      features: licensedFeatures(payload),
      limits: licensedLimits(payload),
      graceDays: payload.graceDays,
    },
    subscription: usable
      ? {
          status: 'ACTIVE',
          trialEndsAt: null,
          currentPeriodEnd: new Date(payload.expiresAt),
          graceEndsAt: null,
        }
      : { status: 'EXPIRED', trialEndsAt: null, currentPeriodEnd: null, graceEndsAt: null },
  };
}
