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
  withContext,
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
    await owner.attendancePunch.deleteMany({ where: tenants });
    await owner.attendanceCorrection.deleteMany({ where: tenants });
    await owner.shiftAssignment.deleteMany({ where: tenants });
    await owner.shift.deleteMany({ where: tenants });
    await owner.employeeEvent.deleteMany({ where: tenants });
    await owner.employee.deleteMany({ where: tenants });
    await owner.lookupValue.deleteMany({ where: tenants });
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

describe('installation licence', () => {
  const row = () => ({
    licenceId: randomUUID(),
    token: 'SHRL1.test.test',
    customerName: 'Probe',
    planCode: 'ENTERPRISE',
    expiresAt: new Date(Date.now() + 86_400_000),
  });

  it('lets anyone read the installation, but nobody in the app change it', async () => {
    const [installation] = await app.installation.findMany();
    expect(installation).toBeDefined();
    const error = await expectRejected(
      withContext(
        app,
        { platformActor: true },
        (tx) => tx.$executeRaw`UPDATE installation SET created_at = now()`,
      ),
    );
    expect(String(error)).toMatch(/permission denied/i);
  });

  it('lets only platform actors install a licence, and never delete one', async () => {
    const error = await expectRejected(
      withTenant(app, tenantA, (tx) => tx.installationLicence.createMany({ data: [row()] })),
    );
    expect(String(error)).toMatch(/row-level security/i);

    const data = row();
    await withContext(app, { platformActor: true }, (tx) =>
      tx.installationLicence.createMany({ data: [data] }),
    );
    expect(await app.installationLicence.count({ where: { licenceId: data.licenceId } })).toBe(1);
    // Marking replaced outside a platform transaction matches nothing; deleting isn't granted at all.
    expect(
      await withTenant(app, tenantA, (tx) =>
        tx.installationLicence.updateMany({
          where: { licenceId: data.licenceId },
          data: { replacedAt: new Date() },
        }),
      ),
    ).toEqual({ count: 0 });
    const del = await expectRejected(
      withContext(app, { platformActor: true }, (tx) =>
        tx.installationLicence.deleteMany({ where: { licenceId: data.licenceId } }),
      ),
    );
    expect(String(del)).toMatch(/permission denied/i);
    await owner.installationLicence.deleteMany({ where: { licenceId: data.licenceId } });
  });
});

describe('employee records', () => {
  it('isolates employees by tenant, checks reference lists and keeps history append-only', async () => {
    const grade = await owner.lookupValue.create({
      data: { tenantId: tenantA, list: 'grade', code: `G-${run}`, name: 'G' },
    });
    const designation = await owner.lookupValue.create({
      data: { tenantId: tenantA, list: 'designation', code: `D-${run}`, name: 'D' },
    });
    const employee = await withTenant(app, tenantA, (tx) =>
      tx.employee.create({
        data: {
          tenantId: tenantA,
          employeeCode: `E-${run}`,
          firstName: 'A',
          lastName: 'B',
          companyId: companyA,
          designationId: designation.id,
          dateOfJoining: new Date('2026-01-01'),
        },
      }),
    );
    expect(await withTenant(app, tenantB, (tx) => tx.employee.count())).toBe(0);

    // A grade can't be stored as a designation, and nobody manages themself.
    const wrongList = await expectRejected(
      withTenant(app, tenantA, (tx) =>
        tx.employee.update({ where: { id: employee.id }, data: { designationId: grade.id } }),
      ),
    );
    expect(String(wrongList)).toMatch(/must reference a designation value/);
    const self = await expectRejected(
      withTenant(app, tenantA, (tx) =>
        tx.employee.update({ where: { id: employee.id }, data: { managerId: employee.id } }),
      ),
    );
    expect(String(self)).toMatch(/own manager/);

    // Another tenant's company can't be referenced, even by id.
    const crossTenant = await expectRejected(
      withTenant(app, tenantA, (tx) =>
        tx.employee.update({ where: { id: employee.id }, data: { companyId: companyB } }),
      ),
    );
    expect(String(crossTenant)).toMatch(/foreign key|violates/i);

    await withTenant(app, tenantA, (tx) =>
      tx.employeeEvent.create({
        data: {
          tenantId: tenantA,
          employeeId: employee.id,
          kind: 'JOINED',
          effectiveDate: new Date('2026-01-01'),
        },
      }),
    );
    const edit = await expectRejected(
      withTenant(app, tenantA, (tx) => tx.$executeRaw`UPDATE employee_event SET note = 'x'`),
    );
    expect(String(edit)).toMatch(/permission denied/i);
    const del = await expectRejected(withTenant(app, tenantA, (tx) => tx.$executeRaw`DELETE FROM employee`));
    expect(String(del)).toMatch(/permission denied/i);
  });
});

describe('attendance', () => {
  it('isolates attendance by tenant, keeps clock-ins append-only, checks shifts and closes decided corrections', async () => {
    const employee = await withTenant(app, tenantA, (tx) =>
      tx.employee.create({
        data: {
          tenantId: tenantA,
          employeeCode: `ATT-${run}`,
          firstName: 'C',
          lastName: 'D',
          companyId: companyA,
          dateOfJoining: new Date('2026-01-01'),
        },
      }),
    );
    await withTenant(app, tenantA, (tx) =>
      tx.attendancePunch.create({
        data: { tenantId: tenantA, employeeId: employee.id, at: new Date(), direction: 'IN', source: 'WEB' },
      }),
    );
    expect(await withTenant(app, tenantB, (tx) => tx.attendancePunch.count())).toBe(0);

    for (const statement of [
      (tx: TenantTransaction) => tx.$executeRaw`UPDATE attendance_punch SET direction = 'OUT'`,
      (tx: TenantTransaction) => tx.$executeRaw`DELETE FROM attendance_punch`,
      (tx: TenantTransaction) => tx.$executeRaw`DELETE FROM shift_assignment`,
    ]) {
      expect(String(await expectRejected(withTenant(app, tenantA, statement)))).toMatch(/permission denied/i);
    }

    const badShift = await expectRejected(
      withTenant(app, tenantA, (tx) =>
        tx.shift.create({
          data: { tenantId: tenantA, code: 'BAD', name: 'Bad', startMinute: 600, endMinute: 600 },
        }),
      ),
    );
    expect(String(badShift)).toMatch(/must be different/);

    const correction = await withTenant(app, tenantA, (tx) =>
      tx.attendanceCorrection.create({
        data: {
          tenantId: tenantA,
          employeeId: employee.id,
          date: new Date('2026-02-02'),
          reason: 'test',
          requestedByUserId: userA,
          status: 'REJECTED',
        },
      }),
    );
    const reopen = await expectRejected(
      withTenant(app, tenantA, (tx) =>
        tx.attendanceCorrection.update({ where: { id: correction.id }, data: { status: 'APPROVED' } }),
      ),
    );
    expect(String(reopen)).toMatch(/already rejected/);
  });
});
