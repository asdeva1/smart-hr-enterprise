import { describe, expect, it, vi } from 'vitest';
import { InvalidTenantContextError, withTenant, type DatabaseClient } from './index.js';

describe('withTenant', () => {
  it('refuses a tenant id that is not a UUID before touching the database', async () => {
    const transaction = vi.fn();
    const db = { $transaction: transaction } as unknown as DatabaseClient;

    await expect(withTenant(db, "x' OR '1'='1", () => Promise.resolve(1))).rejects.toBeInstanceOf(
      InvalidTenantContextError,
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});
