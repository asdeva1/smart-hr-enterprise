/**
 * The API and worker refuse to start on a connection that would bypass row-level security.
 *
 * Requires DATABASE_URL (app_rw) and DATABASE_MIGRATOR_URL (app_migrator, the table owner).
 */
import { describe, expect, it } from 'vitest';
import { assertRestrictedRuntimeRole, ensureRuntimeRole, UnsafeDatabaseRoleError } from '../src/index.js';

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set for integration tests`);
  return value;
};

describe('runtime database role', () => {
  it('accepts the restricted runtime role', async () => {
    await expect(assertRestrictedRuntimeRole(env('DATABASE_URL'))).resolves.toBeUndefined();
  });

  it('refuses the table owner, which row-level security does not bind', async () => {
    const attempt = assertRestrictedRuntimeRole(env('DATABASE_MIGRATOR_URL'));
    await expect(attempt).rejects.toBeInstanceOf(UnsafeDatabaseRoleError);
    await expect(assertRestrictedRuntimeRole(env('DATABASE_MIGRATOR_URL'))).rejects.toThrow(
      /owns \d+ application tables/,
    );
  });

  it('leaves an existing restricted runtime role alone', async () => {
    await expect(ensureRuntimeRole(env('DATABASE_MIGRATOR_URL'))).resolves.toEqual({
      created: false,
      login: false,
    });
  });
});
