/**
 * Organisation structure and roles at the database layer, against a real migrated database:
 * row-level security, tenant-qualified foreign keys, and the runtime role's grants.
 * Requires DATABASE_URL (app_rw) and DATABASE_MIGRATOR_URL (owner, fixtures only).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabaseClient,
  isForeignKeyViolation,
  withTenant,
  type DatabaseClient,
  type TenantTransaction,
} from '../src/index.js';

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
let companyA: string;
let companyB: string;
let deptB: string;
let roleB: string;
let memberA: string;
let userA: string;

beforeAll(async () => {
  owner = createDatabaseClient({ connectionString: requireEnv('DATABASE_MIGRATOR_URL'), maxConnections: 2 });
  app = createDatabaseClient({ connectionString: requireEnv('DATABASE_URL'), maxConnections: 2 });

  tenantA = (await owner.tenant.create({ data: { slug: `oa-${run}`, name: 'Org A' } })).id;
  tenantB = (await owner.tenant.create({ data: { slug: `ob-${run}`, name: 'Org B' } })).id;
  const company = (tenantId: string, code: string) =>
    owner.company.create({
      data: { tenantId, code, name: code, country: 'IN', baseCurrency: 'INR', timezone: 'Asia/Kolkata' },
    });
  companyA = (await company(tenantA, `CA${run}`)).id;
  companyB = (await company(tenantB, `CB${run}`)).id;
  deptB = (
    await owner.department.create({
      data: { tenantId: tenantB, companyId: companyB, code: `DB${run}`, name: 'Finance' },
    })
  ).id;
  roleB = (await owner.role.create({ data: { tenantId: tenantB, key: `r_${run}`, name: 'B role' } })).id;
  userA = (await owner.user.create({ data: { email: `oa-${run}@test.local`, displayName: 'A' } })).id;
  memberA = (await owner.tenantMembership.create({ data: { tenantId: tenantA, userId: userA } })).id;
});

afterAll(async () => {
  if (owner) {
    const tenants = { tenantId: { in: [tenantA, tenantB] } };
    await owner.roleAssignment.deleteMany({ where: tenants });
    await owner.rolePermission.deleteMany({ where: tenants });
    await owner.role.deleteMany({ where: tenants });
    await owner.department.deleteMany({ where: { ...tenants, parentId: { not: null } } });
    await owner.department.deleteMany({ where: tenants });
    await owner.branch.deleteMany({ where: tenants });
    await owner.company.deleteMany({ where: tenants });
    await owner.tenantMembership.deleteMany({ where: tenants });
    await owner.user.deleteMany({ where: { id: userA } });
    await owner.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await owner.$disconnect();
  }
  await app?.$disconnect();
});

async function expectRejected(work: Promise<unknown>) {
  const error = await work.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, 'expected the database to refuse this write').not.toBeNull();
  return error;
}

describe('organisation tables', () => {
  it('show each tenant only its own companies', async () => {
    const inA = await withTenant(app, tenantA, (tx) => tx.company.findMany({ select: { id: true } }));
    expect(inA.map((c) => c.id)).toEqual([companyA]);
    const unknownId = await withTenant(app, tenantA, (tx) =>
      tx.company.findUnique({ where: { id: companyB } }),
    );
    expect(unknownId).toBeNull();
  });

  // Foreign-key checks bypass RLS, so only a tenant-qualified key stops a cross-tenant reference.
  it('refuse a branch that points at another tenant’s company', async () => {
    const error = await expectRejected(
      withTenant(app, tenantA, (tx) =>
        tx.branch.create({ data: { tenantId: tenantA, companyId: companyB, code: `X${run}`, name: 'X' } }),
      ),
    );
    expect(isForeignKeyViolation(error)).toBe(true);
  });

  it('refuse a department under another tenant’s department', async () => {
    const error = await expectRejected(
      withTenant(app, tenantA, (tx) =>
        tx.department.create({
          data: { tenantId: tenantA, companyId: companyA, parentId: deptB, code: `Y${run}`, name: 'Y' },
        }),
      ),
    );
    expect(isForeignKeyViolation(error)).toBe(true);
  });

  it('refuse a role assignment that uses another tenant’s role', async () => {
    const error = await expectRejected(
      withTenant(app, tenantA, (tx) =>
        tx.roleAssignment.create({
          data: {
            tenantId: tenantA,
            membershipId: memberA,
            roleId: roleB,
            scopeType: 'TENANT',
            scopeId: tenantA,
          },
        }),
      ),
    );
    expect(isForeignKeyViolation(error)).toBe(true);
  });

  it('refuse rows written for another tenant', async () => {
    await expectRejected(
      withTenant(app, tenantA, (tx) =>
        tx.company.create({
          data: {
            tenantId: tenantB,
            code: `Z${run}`,
            name: 'Z',
            country: 'IN',
            baseCurrency: 'INR',
            timezone: 'Asia/Kolkata',
          },
        }),
      ),
    );
  });

  it('never let the runtime role delete organisation records', async () => {
    const error = await expectRejected(
      withTenant(app, tenantA, (tx) => tx.$executeRaw`DELETE FROM company WHERE id = ${companyA}::uuid`),
    );
    expect(String(error)).toMatch(/permission denied/i);
  });
});

describe('tenant security policy', () => {
  it('lets the runtime role change only require_mfa, and only on its own tenant', async () => {
    await withTenant(app, tenantA, (tx) =>
      tx.tenant.update({ where: { id: tenantA }, data: { requireMfa: true } }),
    );
    expect((await owner.tenant.findUnique({ where: { id: tenantA } }))?.requireMfa).toBe(true);

    // Another tenant's row is invisible, so the update matches nothing.
    const other = await withTenant(
      app,
      tenantA,
      (tx) => tx.$executeRaw`UPDATE tenant SET require_mfa = true WHERE id = ${tenantB}::uuid`,
    );
    expect(other).toBe(0);
    expect((await owner.tenant.findUnique({ where: { id: tenantB } }))?.requireMfa).toBe(false);

    // Identity columns are not granted at all.
    const error = await expectRejected(
      withTenant(
        app,
        tenantA,
        (tx) => tx.$executeRaw`UPDATE tenant SET slug = 'hijacked' WHERE id = ${tenantA}::uuid`,
      ),
    );
    expect(String(error)).toMatch(/permission denied/i);

    // Name and lifecycle are granted for the platform console, but the guard trigger refuses them in an
    // ordinary tenant transaction.
    for (const change of [
      (tx: TenantTransaction) =>
        tx.$executeRaw`UPDATE tenant SET name = 'hijacked' WHERE id = ${tenantA}::uuid`,
      (tx: TenantTransaction) =>
        tx.$executeRaw`UPDATE tenant SET status = 'SUSPENDED' WHERE id = ${tenantA}::uuid`,
      (tx: TenantTransaction) =>
        tx.$executeRaw`UPDATE tenant SET archived_at = now() WHERE id = ${tenantA}::uuid`,
    ]) {
      expect(String(await expectRejected(withTenant(app, tenantA, change)))).toMatch(
        /platform operators only/,
      );
    }

    // Branding is the tenant's own to change.
    await withTenant(app, tenantA, (tx) =>
      tx.tenant.update({ where: { id: tenantA }, data: { brandName: 'Acme Brand', brandColor: '#1d4ed8' } }),
    );
    expect((await owner.tenant.findUnique({ where: { id: tenantA } }))?.brandName).toBe('Acme Brand');
  });

  it('keeps sign-up requests invisible outside a platform transaction', async () => {
    await owner.signupRequest.create({
      data: {
        email: `rls-${Date.now()}@example.com`,
        displayName: 'Probe',
        organisationName: 'Probe Org',
        tokenHash: `probe-${Date.now()}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    expect(await withTenant(app, tenantA, (tx) => tx.signupRequest.count())).toBe(0);
    expect(await app.signupRequest.count()).toBe(0);
    await owner.signupRequest.deleteMany({ where: { displayName: 'Probe' } });
  });
});
