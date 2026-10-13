import { describe, expect, it } from 'vitest';
import { baseServerEnvSchema, commaList, EnvValidationError, loadEnv, z } from './index.js';

const valid = {
  DATABASE_URL: 'postgresql://app_rw:secret@localhost:5432/smart_hr',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadEnv', () => {
  it('applies defaults for optional fields', () => {
    const env = loadEnv(baseServerEnvSchema, valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.DEPLOYMENT_MODE).toBe('saas');
  });

  it('lists every invalid key without echoing secret values', () => {
    try {
      loadEnv(baseServerEnvSchema, { DATABASE_URL: 'mysql://u:hunter2@db/x', DEPLOYMENT_MODE: 'cloud' });
      expect.fail('expected validation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('REDIS_URL');
      expect(message).toContain('DEPLOYMENT_MODE');
      expect(message).not.toContain('hunter2');
    }
  });
});

describe('commaList', () => {
  it('splits, trims and drops empty entries', () => {
    const schema = z.object({ ORIGINS: commaList });
    expect(schema.parse({ ORIGINS: ' http://a.test , ,http://b.test' }).ORIGINS).toEqual([
      'http://a.test',
      'http://b.test',
    ]);
    expect(schema.parse({}).ORIGINS).toEqual([]);
  });
});
