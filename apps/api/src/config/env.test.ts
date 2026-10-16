import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadApiEnv } from './env.js';

const key = () => randomBytes(32).toString('base64');
const base = (overrides: Record<string, string> = {}) => ({
  DATABASE_URL: 'postgresql://app_rw:x@localhost:5432/smart_hr',
  REDIS_URL: 'redis://localhost:6379',
  CORS_ORIGINS: 'http://localhost:3000',
  MFA_ENCRYPTION_KEYS: `m1:${key()}`,
  MFA_ENCRYPTION_KEY_ID: 'm1',
  DATA_ENCRYPTION_KEYS: `d1:${key()}`,
  DATA_ENCRYPTION_KEY_ID: 'd1',
  ...overrides,
});

describe('encryption keys', () => {
  it('accepts separate key rings for two-step verification and personal data', () => {
    const env = loadApiEnv(base());
    expect(Object.keys(env.DATA_ENCRYPTION_KEYS)).toEqual(['d1']);
  });

  it('refuses a missing personal-data key, an unknown current key and a reused MFA key', () => {
    const { DATA_ENCRYPTION_KEYS: _omit, ...withoutData } = base();
    expect(() => loadApiEnv(withoutData)).toThrow(/DATA_ENCRYPTION_KEYS/);
    expect(() => loadApiEnv(base({ DATA_ENCRYPTION_KEY_ID: 'nope' }))).toThrow(/DATA_ENCRYPTION_KEY_ID/);
    const shared = key();
    expect(() =>
      loadApiEnv(base({ MFA_ENCRYPTION_KEYS: `m1:${shared}`, DATA_ENCRYPTION_KEYS: `d1:${shared}` })),
    ).toThrow(/must not reuse a key/);
  });

  it('never echoes key material in the error', () => {
    const secret = key();
    try {
      loadApiEnv(base({ MFA_ENCRYPTION_KEYS: `m1:${secret}`, DATA_ENCRYPTION_KEYS: `d1:${secret}` }));
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
