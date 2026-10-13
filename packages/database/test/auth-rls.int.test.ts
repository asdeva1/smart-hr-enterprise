/**
 * Row-level security for memberships and the audit log, against a real migrated database.
 * Requires DATABASE_URL (app_rw) and DATABASE_MIGRATOR_URL (owner, fixtures only).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseClient, withContext, withTenant, type DatabaseClient } from '../src/index.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set for integration tests`);
  return value;
}

let owner: DatabaseClient;
let app: DatabaseClient;
const run = randomUUID().slice(0, 8);
let tenantA: string;
let tenantB: string;
let alice: string; // member of A only
let bob: string; // member of B only

beforeAll(async () => {
  owner = createDatabaseClient({ connectionString: requireEnv('DATABASE_MIGRATOR_URL'), maxConnections: 2 });
  app = createDatabaseClient({ connectionString: requireEnv('DATABASE_URL'), maxConnections: 2 });

  tenantA = (await owner.tenant.create({ data: { slug: `a-${run}`, name: 'A' } })).id;
  tenantB = (await owner.tenant.create({ data: { slug: `b-${run}`, name: 'B' } })).id;
  alice = (await owner.user.create({ data: { email: `alice-${run}@test.local`, displayName: 'Alice' } })).id;
  bob = (await owner.user.create({ data: { email: `bob-${run}@test.local`, displayName: 'Bob' } })).id;
  await owner.tenantMembership.createMany({
    data: [
      { tenantId: tenantA, userId: alice },
      { tenantId: tenantB, userId: bob },
    ],
  });
});

afterAll(async () => {
  if (owner) {
    await owner.tenantMembership.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await owner.user.deleteMany({ where: { id: { in: [alice, bob] } } });
    await owner.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await owner.$disconnect();
  }
  await app?.$disconnect();
});

describe('tenant memberships', () => {
  it('lets a user see only their own memberships before choosing a tenant', async () => {
    const mine = await withContext(app, { userId: alice }, (tx) =>
      tx.tenantMembership.findMany({ include: { tenant: true } }),
    );
    expect(mine.map((m) => [m.userId, m.tenant.id])).toEqual([[alice, tenantA]]);
  });

  it('hides other tenants’ memberships inside a tenant', async () => {
    const inA = await withTenant(app, tenantA, (tx) => tx.tenantMembership.findMany());
    expect(inA.map((m) => m.userId)).toEqual([alice]);
  });

  it('refuses to create a membership in another tenant', async () => {
    await expect(
      withTenant(app, tenantA, (tx) =>
        tx.tenantMembership.create({ data: { tenantId: tenantB, userId: alice } }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('shows tenant names only for tenants the user belongs to', async () => {
    const tenants = await withContext(app, { userId: bob }, (tx) => tx.tenant.findMany());
    expect(tenants.map((t) => t.id)).toEqual([tenantB]);
  });

  it('sees nothing without any context', async () => {
    expect(await app.tenantMembership.findMany({ where: { userId: { in: [alice, bob] } } })).toEqual([]);
  });
});

describe('audit log', () => {
  it('accepts platform events and the current tenant’s events', async () => {
    await withContext(app, { userId: alice }, (tx) =>
      tx.auditEvent.create({
        data: { action: `test.platform.${run}`, outcome: 'SUCCESS', actorUserId: alice },
      }),
    );
    await withTenant(app, tenantA, (tx) =>
      tx.auditEvent.create({ data: { action: `test.tenant.${run}`, outcome: 'SUCCESS', tenantId: tenantA } }),
    );
  });

  it('refuses an event written into another tenant', async () => {
    await expect(
      withTenant(app, tenantA, (tx) =>
        tx.auditEvent.create({
          data: { action: `test.forged.${run}`, outcome: 'SUCCESS', tenantId: tenantB },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('shows a user their own sign-in history but not someone else’s', async () => {
    await withContext(app, { userId: bob }, (tx) =>
      tx.auditEvent.create({ data: { action: `test.bob.${run}`, outcome: 'SUCCESS', actorUserId: bob } }),
    );
    const seenByAlice = await withContext(app, { userId: alice }, (tx) =>
      tx.auditEvent.findMany({ where: { action: { endsWith: run } } }),
    );
    expect(seenByAlice.map((e) => e.action)).toEqual([`test.platform.${run}`]);
  });

  it('cannot be changed or deleted by the runtime role', async () => {
    await expect(
      withTenant(app, tenantA, (tx) =>
        tx.auditEvent.updateMany({ where: { action: `test.tenant.${run}` }, data: { outcome: 'FAILURE' } }),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withTenant(app, tenantA, (tx) => tx.auditEvent.deleteMany({ where: { action: `test.tenant.${run}` } })),
    ).rejects.toThrow(/permission denied/i);
  });

  it('cannot be changed or deleted even by the table owner', async () => {
    await expect(
      owner.auditEvent.updateMany({ where: { action: `test.tenant.${run}` }, data: { outcome: 'FAILURE' } }),
    ).rejects.toThrow(/append-only/);
    await expect(owner.auditEvent.deleteMany({ where: { action: `test.tenant.${run}` } })).rejects.toThrow(
      /append-only/,
    );
  });
});

describe('withContext', () => {
  it('requires at least one context value', async () => {
    await expect(withContext(app, {}, () => Promise.resolve(1))).rejects.toThrow(/Tenant context/);
  });

  it('rejects a user id that is not a UUID', async () => {
    await expect(
      withContext(app, { userId: "'; drop table x; --" }, () => Promise.resolve(1)),
    ).rejects.toThrow(/Tenant context/);
  });
});
