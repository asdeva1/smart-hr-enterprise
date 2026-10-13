/**
 * Tenant isolation tests against a real, migrated PostgreSQL database.
 *
 * Requires:
 *   DATABASE_URL           runtime role (app_rw), bound by row-level security
 *   DATABASE_MIGRATOR_URL  schema owner (app_migrator), used only to create fixtures
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseClient, withTenant, type DatabaseClient } from '../src/index.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set for integration tests`);
  return value;
}

let owner: DatabaseClient;
let app: DatabaseClient;
let tenantA: string;
let tenantB: string;
const run = randomUUID().slice(0, 8);

beforeAll(async () => {
  owner = createDatabaseClient({ connectionString: requireEnv('DATABASE_MIGRATOR_URL'), maxConnections: 2 });
  // One connection, so every test reuses it — this is what makes the leak test meaningful.
  app = createDatabaseClient({ connectionString: requireEnv('DATABASE_URL'), maxConnections: 1 });

  const a = await owner.tenant.create({ data: { slug: `acme-${run}`, name: 'Acme' } });
  const b = await owner.tenant.create({ data: { slug: `globex-${run}`, name: 'Globex' } });
  tenantA = a.id;
  tenantB = b.id;

  await owner.tenantSetting.createMany({
    data: [
      { tenantId: tenantA, key: 'timezone', value: 'Asia/Kolkata' },
      { tenantId: tenantA, key: 'week_start', value: 'MONDAY' },
      { tenantId: tenantB, key: 'timezone', value: 'Asia/Dubai' },
    ],
  });
});

afterAll(async () => {
  if (owner) {
    await owner.tenantSetting.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await owner.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await owner.$disconnect();
  }
  await app?.$disconnect();
});

describe('runtime database role', () => {
  it('cannot bypass row-level security and owns no tables', async () => {
    const [role] = await app.$queryRaw<{ rolname: string; rolbypassrls: boolean; rolsuper: boolean }[]>`
      SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`;
    expect(role).toEqual({ rolname: 'app_rw', rolbypassrls: false, rolsuper: false });

    const owned = await app.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user`;
    expect(Number(owned[0]?.count)).toBe(0);
  });

  it('has row-level security enabled on every table that has a tenant_id column', async () => {
    const unprotected = await app.$queryRaw<{ table_name: string }[]>`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`;
    expect(unprotected).toEqual([]);
  });
});

describe('tenant isolation', () => {
  it('fails closed: without a tenant context nothing is visible', async () => {
    expect(await app.tenantSetting.findMany()).toEqual([]);
    expect(await app.tenant.findMany()).toEqual([]);
  });

  it('shows only the current tenant’s rows', async () => {
    const rows = await withTenant(app, tenantA, (tx) =>
      tx.tenantSetting.findMany({ orderBy: { key: 'asc' } }),
    );
    expect(rows.map((row) => [row.tenantId, row.key])).toEqual([
      [tenantA, 'timezone'],
      [tenantA, 'week_start'],
    ]);

    const tenants = await withTenant(app, tenantA, (tx) => tx.tenant.findMany());
    expect(tenants.map((tenant) => tenant.id)).toEqual([tenantA]);
  });

  it('refuses to write a row for another tenant', async () => {
    await expect(
      withTenant(app, tenantA, (tx) =>
        tx.tenantSetting.create({ data: { tenantId: tenantB, key: 'injected', value: true } }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot update or delete another tenant’s rows', async () => {
    const updated = await withTenant(app, tenantA, (tx) =>
      tx.tenantSetting.updateMany({ where: { tenantId: tenantB }, data: { value: 'hijacked' } }),
    );
    const deleted = await withTenant(app, tenantA, (tx) =>
      tx.tenantSetting.deleteMany({ where: { tenantId: tenantB } }),
    );
    expect(updated.count).toBe(0);
    expect(deleted.count).toBe(0);

    const untouched = await owner.tenantSetting.findMany({ where: { tenantId: tenantB } });
    expect(untouched.map((row) => row.value)).toEqual(['Asia/Dubai']);
  });

  it('does not leak the tenant context to the next use of a pooled connection', async () => {
    await withTenant(app, tenantA, (tx) => tx.tenantSetting.findMany());
    expect(await app.tenantSetting.findMany()).toEqual([]);
  });

  it('keeps tenants apart under concurrent requests', async () => {
    const pooled = createDatabaseClient({ connectionString: requireEnv('DATABASE_URL'), maxConnections: 5 });
    try {
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) => {
          const tenantId = i % 2 === 0 ? tenantA : tenantB;
          return withTenant(pooled, tenantId, async (tx) => ({
            tenantId,
            seen: (await tx.tenantSetting.findMany()).map((row) => row.tenantId),
          }));
        }),
      );
      for (const { tenantId, seen } of results) {
        expect(seen.length).toBeGreaterThan(0);
        expect(new Set(seen)).toEqual(new Set([tenantId]));
      }
    } finally {
      await pooled.$disconnect();
    }
  });
});
