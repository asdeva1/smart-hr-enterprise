/**
 * Permanently deleting an organisation through the real API and database: everything of the organisation goes
 * (finance journals included), its stored files are removed, another organisation is left untouched, sign-in
 * accounts go only when asked and only when they belong nowhere else, and only a confirmed operator can do it.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDatabaseClient } from '@smart-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiEnv } from '../src/config/env.js';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import {
  Browser,
  DEFAULT_PASSWORD,
  Fixtures,
  ownerClient,
  requireEnv,
  startApp,
  testEnv,
} from './helpers.js';

let env: ApiEnv;
let app: NestExpressApplication;
const db = ownerClient();
const runtime = createDatabaseClient({ connectionString: requireEnv('DATABASE_URL'), maxConnections: 2 });
const fx = new Fixtures(db);
let operator: Browser;

beforeAll(async () => {
  await syncPlanCatalogue(db);
  env = testEnv();
  app = await startApp(env);
  const admin = await fx.user('del-operator', { platformAdmin: true });
  operator = new Browser(app);
  expect((await operator.login(admin.email)).status).toBe(200);
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await runtime.$disconnect();
  await db.$disconnect();
});

async function organisation(name: string) {
  const tenant = await fx.tenant(name);
  const ownerUser = await fx.user(`${name}-owner`);
  await fx.member(tenant.id, ownerUser.id, true);
  const owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  return { tenant, ownerUser, owner };
}

describe('deleting an organisation', () => {
  it('removes its data, journals, files and (when asked) its own accounts, and nothing else', async () => {
    const victim = await organisation('Victim');
    const bystander = await organisation('Bystander');
    const company = await fx.company(victim.tenant.id, 'VIC');
    await fx.company(bystander.tenant.id, 'BYS');

    // A shared person belongs to both, so their account must survive.
    const shared = await fx.user('Shared-person');
    await fx.member(victim.tenant.id, shared.id);
    await fx.member(bystander.tenant.id, shared.id);

    // Self-referencing data: a department tree and an employee reporting to another.
    const parent = await db.department.create({
      data: { tenantId: victim.tenant.id, companyId: company.id, code: 'ENG', name: 'Engineering' },
    });
    await db.department.create({
      data: {
        tenantId: victim.tenant.id,
        companyId: company.id,
        code: 'ENG-PLAT',
        name: 'Platform',
        parentId: parent.id,
      },
    });
    const boss = await db.employee.create({
      data: {
        tenantId: victim.tenant.id,
        companyId: company.id,
        employeeCode: 'E1',
        firstName: 'Bo',
        lastName: 'Ss',
        dateOfJoining: new Date('2024-01-01'),
      },
    });
    await db.employee.create({
      data: {
        tenantId: victim.tenant.id,
        companyId: company.id,
        employeeCode: 'E2',
        firstName: 'Re',
        lastName: 'Port',
        dateOfJoining: new Date('2024-02-01'),
        managerId: boss.id,
      },
    });

    // Books with posted journals (journal lines are guarded against deletion).
    const S = '/v1/finance/sales';
    expect(
      (await victim.owner.send('put', `${S}/settings/${company.id}`, { gstin: '27AAPFU0939F1ZV' })).status,
    ).toBe(200);
    const customer = await victim.owner.send('post', `${S}/customers`, {
      name: 'Northwind',
      gstin: '27AAPFU0939F1ZV',
    });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    const invoice = await victim.owner.send('post', `${S}/documents`, {
      companyId: company.id,
      customerId: customer.body.id,
      type: 'INVOICE',
      date: '2026-04-10',
      lines: [{ description: 'Work', hsn: '998314', quantity: 1, rate: 1000, gstRate: 18 }],
    });
    expect((await victim.owner.send('post', `${S}/documents/${invoice.body.id}/issue`)).status).toBe(200);
    expect(await db.journalLine.count({ where: { tenantId: victim.tenant.id } })).toBeGreaterThan(0);

    // A bank statement line matched to one of those journal lines must not stand in the way of deleting.
    const debitLine = await db.journalLine.findFirstOrThrow({
      where: { tenantId: victim.tenant.id, debit: { gt: 0 } },
    });
    const bankStatement = await db.bankStatement.create({
      data: {
        tenantId: victim.tenant.id,
        companyId: company.id,
        accountId: debitLine.accountId,
        fileName: 'x.csv',
        periodFrom: new Date('2026-04-10'),
        periodTo: new Date('2026-04-10'),
        lineCount: 1,
        importedByUserId: victim.ownerUser.id,
      },
    });
    await db.bankStatementLine.create({
      data: {
        tenantId: victim.tenant.id,
        statementId: bankStatement.id,
        companyId: company.id,
        accountId: debitLine.accountId,
        date: new Date('2026-04-10'),
        description: 'Matched',
        deposit: debitLine.debit,
        dedupeKey: 'k1',
        status: 'MATCHED',
        journalLineId: debitLine.id,
      },
    });

    // A stored file on disk.
    const fileId = randomUUID();
    const key = `${victim.tenant.id}/${fileId}`;
    mkdirSync(join(env.STORAGE_LOCAL_DIR, victim.tenant.id), { recursive: true });
    writeFileSync(join(env.STORAGE_LOCAL_DIR, key), 'encrypted-bytes');
    await db.storedFile.create({
      data: {
        id: fileId,
        tenantId: victim.tenant.id,
        storageKey: key,
        fileName: 'offer.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 15,
        sha256: 'a'.repeat(64),
        encryptionKeyId: 'd1',
      },
    });

    const path = `/v1/platform/tenants/${victim.tenant.id}/delete`;
    const body = { confirmSlug: victim.tenant.slug, reason: 'Test organisation', deleteAccounts: true };

    // Wrong address, a non-operator, and a stale password entry are all refused.
    expect((await operator.send('post', path, { ...body, confirmSlug: 'nope' })).body.code).toBe(
      'CONFIRMATION_MISMATCH',
    );
    expect((await victim.owner.send('post', path, body)).status).toBe(403);
    await db.userSession.updateMany({
      where: { user: { isPlatformAdmin: true } },
      data: { reauthenticatedAt: null },
    });
    expect((await operator.send('post', path, body)).body.code).toBe('REAUTH_REQUIRED');
    const adminUser = await db.user.findFirstOrThrow({ where: { email: { contains: 'del-operator' } } });
    expect(
      (await operator.send('post', '/v1/auth/reauthenticate', { password: DEFAULT_PASSWORD })).status,
    ).toBe(204);
    expect(adminUser.isPlatformAdmin).toBe(true);
    expect(await db.tenant.findUnique({ where: { id: victim.tenant.id } })).not.toBeNull();

    const res = await operator.send('post', path, body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ deleted: true, accountsDeleted: 1, files: { removed: 1, failed: 0 } });
    expect(res.body.records).toBeGreaterThan(5);

    // Gone: the organisation, its rows, the file, and the owner's account.
    expect(await db.tenant.findUnique({ where: { id: victim.tenant.id } })).toBeNull();
    expect(await db.company.count({ where: { tenantId: victim.tenant.id } })).toBe(0);
    expect(await db.journalLine.count({ where: { tenantId: victim.tenant.id } })).toBe(0);
    expect(await db.bankStatementLine.count({ where: { tenantId: victim.tenant.id } })).toBe(0);
    expect(await db.employee.count({ where: { tenantId: victim.tenant.id } })).toBe(0);
    expect(existsSync(join(env.STORAGE_LOCAL_DIR, key))).toBe(false);
    expect(await db.user.findUnique({ where: { id: victim.ownerUser.id } })).toBeNull();
    // Kept: the shared person, the operator, the other organisation, and the record of the deletion.
    expect(await db.user.findUnique({ where: { id: shared.id } })).not.toBeNull();
    expect(adminUser.id).toBeTruthy();
    expect(await db.user.findUnique({ where: { id: adminUser.id } })).not.toBeNull();
    expect(await db.company.count({ where: { tenantId: bystander.tenant.id } })).toBe(1);
    expect(await db.tenantMembership.count({ where: { tenantId: bystander.tenant.id } })).toBe(2);
    expect(
      await db.auditEvent.count({ where: { tenantId: victim.tenant.id, action: 'platform.tenant.delete' } }),
    ).toBe(1);
    expect((await operator.send('post', path, body)).status).toBe(404);
  });

  it('keeps sign-in accounts unless asked', async () => {
    const org = await organisation('KeepAccounts');
    const res = await operator.send('post', `/v1/platform/tenants/${org.tenant.id}/delete`, {
      confirmSlug: org.tenant.slug,
      reason: 'Cleanup',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.accountsDeleted).toBe(0);
    expect(await db.user.findUnique({ where: { id: org.ownerUser.id } })).not.toBeNull();
  });
});
