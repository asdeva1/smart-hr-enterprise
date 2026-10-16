/**
 * Employee records through the real API and database: scoped visibility, creation and numbering,
 * versioned corrections, lifecycle events and history, encrypted identity and bank details, emergency
 * contacts, sign-in invitations, CSV import, plan features and limits, and the organisation export.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiEnv } from '../src/config/env.js';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import { Browser, Fixtures, ownerClient, startApp, testEnv } from './helpers.js';

const db = ownerClient();
const fx = new Fixtures(db);
let env: ApiEnv;
let app: NestExpressApplication;

let tenantId: string;
let owner: Browser;
let ownerId: string;
const org = {} as {
  acme: string;
  globex: string;
  hyd: string;
  blr: string;
  globexBranch: string;
  clinical: string;
  nursing: string;
  icu: string;
  finance: string;
};
const look = {} as {
  nurse: string;
  seniorNurse: string;
  g1: string;
  g2: string;
  resigned: string;
  cc: string;
};

async function lookup(list: string, code: string, name: string) {
  return (await db.lookupValue.create({ data: { tenantId, list, code, name } })).id;
}

async function memberWith(
  label: string,
  permissions: string[],
  scope: { type: 'COMPANY' | 'BRANCH' | 'DEPARTMENT'; id: string },
) {
  const user = await fx.user(label);
  const m = await fx.member(tenantId, user.id);
  await fx.assign(tenantId, m.id, await fx.customRole(tenantId, label, permissions), scope);
  const b = new Browser(app);
  expect((await b.login(user.email)).status).toBe(200);
  return b;
}

const base = () => ({
  firstName: 'Test',
  lastName: 'Person',
  companyId: org.acme,
  dateOfJoining: '2025-06-01',
});
async function hire(extra: Record<string, unknown> = {}, as: Browser = owner) {
  const res = await as.send('post', '/v1/employees', { ...base(), ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; employeeCode: string; version: number };
}

beforeAll(async () => {
  await syncPlanCatalogue(db);
  env = testEnv();
  app = await startApp(env);
  const tenant = await fx.tenant('Employees');
  tenantId = tenant.id;
  const ownerUser = await fx.user('emp-owner');
  ownerId = ownerUser.id;
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  await fx.systemRole(tenantId, 'member');

  org.acme = (await fx.company(tenantId, 'ACME')).id;
  org.globex = (await fx.company(tenantId, 'GLOBEX')).id;
  const branch = async (companyId: string, code: string) =>
    (
      await db.branch.create({
        data: { tenantId, companyId, code: `${code}-${fx.run}`.toUpperCase(), name: code },
      })
    ).id;
  org.hyd = await branch(org.acme, 'HYD');
  org.blr = await branch(org.acme, 'BLR');
  org.globexBranch = await branch(org.globex, 'GX');
  const dept = async (code: string, parentId: string | null = null, companyId = org.acme) =>
    (
      await db.department.create({
        data: { tenantId, companyId, parentId, code: `${code}-${fx.run}`.toUpperCase(), name: code },
      })
    ).id;
  org.clinical = await dept('CLIN');
  org.nursing = await dept('NURS', org.clinical);
  org.icu = await dept('ICU', org.nursing);
  org.finance = await dept('FIN');

  look.nurse = await lookup('designation', 'NURSE', 'Staff nurse');
  look.seniorNurse = await lookup('designation', 'SR-NURSE', 'Senior nurse');
  look.g1 = await lookup('grade', 'G1', 'Grade 1');
  look.g2 = await lookup('grade', 'G2', 'Grade 2');
  look.resigned = await lookup('exit_reason', 'RESIGNED', 'Resigned');
  look.cc = await lookup('cost_centre', 'CC-ICU', 'ICU cost centre');
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await db.$disconnect();
});

describe('creating employees', () => {
  it('numbers employees automatically, accepts a typed code, and records joining in the history', async () => {
    const first = await hire({
      firstName: 'Meera',
      lastName: 'Iyer',
      branchId: org.hyd,
      departmentId: org.icu,
      designationId: look.nurse,
      gradeId: look.g1,
    });
    const second = await hire({ firstName: 'Karthik', lastName: 'Reddy' });
    expect(first.employeeCode).toBe('EMP-0001');
    expect(second.employeeCode).toBe('EMP-0002');
    // A hand-typed code that collides with the next automatic one is skipped over.
    await hire({ employeeCode: 'emp-0003', firstName: 'Typed' });
    expect((await hire({ firstName: 'Auto' })).employeeCode).toBe('EMP-0004');

    const history = (await owner.get(`/v1/employees/${first.id}/history`)).body;
    expect(history[0]).toMatchObject({
      kind: 'JOINED',
      effectiveDate: '2025-06-01',
      changes: { designation: { to: 'Staff nurse' }, department: { to: 'ICU' } },
    });
  });

  it('refuses duplicate codes and work emails, and placements outside the company', async () => {
    await hire({ employeeCode: 'DUP-1', workEmail: 'Dup@Acme.example' });
    expect((await owner.send('post', '/v1/employees', { ...base(), employeeCode: 'dup-1' })).body.code).toBe(
      'CODE_TAKEN',
    );
    expect(
      (await owner.send('post', '/v1/employees', { ...base(), workEmail: 'dup@acme.example' })).body.code,
    ).toBe('EMAIL_TAKEN');
    const wrongBranch = await owner.send('post', '/v1/employees', { ...base(), branchId: org.globexBranch });
    expect(wrongBranch.status).toBe(400);
    expect(wrongBranch.body.errors[0].path).toBe('branchId');
  });

  it('only accepts reference values from the right list', async () => {
    const res = await owner.send('post', '/v1/employees', { ...base(), designationId: look.g1 });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].path).toBe('designationId');
    // The database refuses it too, whatever the code path.
    const e = await hire();
    await expect(
      db.employee.update({ where: { id: e.id }, data: { designationId: look.g1 } }),
    ).rejects.toThrow(/designation_id must reference a designation value/);
  });
});

describe('who sees whom', () => {
  it('limits lists and records to the scopes where the member holds employees.view', async () => {
    const inHyd = await hire({ firstName: 'Hyd', lastName: 'Only', branchId: org.hyd });
    const inBlr = await hire({ firstName: 'Blr', lastName: 'Only', branchId: org.blr });
    const inNursing = await hire({ firstName: 'Nursing', lastName: 'Child', departmentId: org.icu });
    const inFinance = await hire({ firstName: 'Finance', lastName: 'Other', departmentId: org.finance });

    const hydHr = await memberWith('hyd-hr', ['employees.view', 'employees.manage'], {
      type: 'BRANCH',
      id: org.hyd,
    });
    const list = (await hydHr.get('/v1/employees?status=ALL&pageSize=200')).body.items as { id: string }[];
    expect(list.map((e) => e.id)).toContain(inHyd.id);
    expect(list.map((e) => e.id)).not.toContain(inBlr.id);
    expect((await hydHr.get(`/v1/employees/${inBlr.id}`)).status).toBe(404);

    // A department scope covers its sub-departments.
    const clinicalViewer = await memberWith('clin-view', ['employees.view'], {
      type: 'DEPARTMENT',
      id: org.clinical,
    });
    const seen = (
      (await clinicalViewer.get('/v1/employees?pageSize=200')).body.items as { id: string }[]
    ).map((e) => e.id);
    expect(seen).toContain(inNursing.id);
    expect(seen).not.toContain(inFinance.id);
    // Viewing doesn't allow changing.
    const patch = await clinicalViewer.send('patch', `/v1/employees/${inNursing.id}`, {
      version: 1,
      firstName: 'X',
    });
    expect(patch.status).toBe(403);

    const outsider = await memberWith('no-hr', ['org.view'], { type: 'COMPANY', id: org.acme });
    expect((await outsider.get('/v1/employees')).status).toBe(403);
  });

  it('searches by name, code and email, and filters by status', async () => {
    await hire({ firstName: 'Zubin', lastName: 'Mehta', workEmail: 'zubin@acme.example' });
    const byName = (await owner.get('/v1/employees?search=zub%20meh')).body as { items: { name: string }[] };
    expect(byName.items.map((e) => e.name)).toEqual(['Zubin Mehta']);
    const byEmail = (await owner.get('/v1/employees?search=zubin@acme')).body;
    expect(byEmail.total).toBe(1);
  });
});

describe('corrections', () => {
  it('needs the version it was based on, and keeps personal values out of the audit log', async () => {
    const e = await hire({ firstName: 'Old' });
    const ok = await owner.send('patch', `/v1/employees/${e.id}`, {
      version: 1,
      firstName: 'New',
      phone: '+91 98765 43210',
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ firstName: 'New', version: 2 });
    const stale = await owner.send('patch', `/v1/employees/${e.id}`, {
      version: 1,
      firstName: 'Lost update',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_RECORD');
    const audit = await db.auditEvent.findFirstOrThrow({
      where: { action: 'employee.update', targetId: e.id },
    });
    expect(audit.metadata).toEqual({ fields: ['firstName', 'phone'] });
    expect(JSON.stringify(audit.metadata)).not.toContain('98765');
  });
});

describe('lifecycle', () => {
  it('records promotions and transfers with effective dates, checking the destination scope', async () => {
    const e = await hire({
      firstName: 'Career',
      branchId: org.hyd,
      designationId: look.nurse,
      gradeId: look.g1,
    });
    const promoted = await owner.send('post', `/v1/employees/${e.id}/lifecycle`, {
      action: 'promotion',
      version: 1,
      effectiveDate: '2026-04-01',
      designationId: look.seniorNurse,
      gradeId: look.g2,
      note: 'Annual review',
    });
    expect(promoted.status).toBe(200);
    expect(promoted.body).toMatchObject({
      designation: { name: 'Senior nurse' },
      grade: { name: 'Grade 2' },
      version: 2,
    });

    // HR for Hyderabad can't move someone into another company.
    const hydHr = await memberWith('hyd-life', ['employees.view', 'employees.lifecycle'], {
      type: 'BRANCH',
      id: org.hyd,
    });
    const away = await hydHr.send('post', `/v1/employees/${e.id}/lifecycle`, {
      action: 'transfer',
      version: 2,
      effectiveDate: '2026-05-01',
      companyId: org.globex,
    });
    expect(away.status).toBe(403);

    const moved = await owner.send('post', `/v1/employees/${e.id}/lifecycle`, {
      action: 'transfer',
      version: 2,
      effectiveDate: '2026-05-01',
      companyId: org.globex,
      branchId: org.globexBranch,
    });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({
      company: { id: org.globex },
      branch: { id: org.globexBranch },
      department: null,
    });
    const history = (await owner.get(`/v1/employees/${e.id}/history`)).body as {
      kind: string;
      changes: object;
      note: string | null;
    }[];
    expect(history.map((h) => h.kind)).toEqual(['TRANSFER', 'PROMOTION', 'JOINED']);
    expect(history[1]).toMatchObject({
      note: 'Annual review',
      changes: { designation: { from: 'Staff nurse', to: 'Senior nurse' } },
    });
  });

  it('refuses reporting loops and nothing-changes', async () => {
    const boss = await hire({ firstName: 'Boss' });
    const mid = await hire({ firstName: 'Mid', managerId: boss.id });
    const loop = await owner.send('post', `/v1/employees/${boss.id}/lifecycle`, {
      action: 'change_manager',
      version: 1,
      effectiveDate: '2026-01-01',
      managerId: mid.id,
    });
    expect(loop.body.code).toBe('MANAGER_CYCLE');
    const same = await owner.send('post', `/v1/employees/${mid.id}/lifecycle`, {
      action: 'change_manager',
      version: 1,
      effectiveDate: '2026-01-01',
      managerId: boss.id,
    });
    expect(same.body.code).toBe('NOTHING_CHANGED');
  });

  it('moves through notice and exit, which needs reports reassigned and ends sign-in access', async () => {
    const leaver = await hire({ firstName: 'Leaving', workEmail: `leaving-${fx.run}@test.local` });
    const report = await hire({ firstName: 'Report', managerId: leaver.id });

    const invited = await owner.send('post', `/v1/employees/${leaver.id}/sign-in`, {});
    expect(invited.status, JSON.stringify(invited.body)).toBe(201);
    const membershipId = invited.body.membershipId as string;
    const user = await db.user.findUniqueOrThrow({ where: { email: `leaving-${fx.run}@test.local` } });
    fx.trackUser(user.id);
    expect(
      await db.roleAssignment.count({ where: { membershipId, scopeType: 'COMPANY', scopeId: org.acme } }),
    ).toBe(1);
    expect((await owner.send('post', `/v1/employees/${leaver.id}/sign-in`, {})).body.code).toBe(
      'ALREADY_LINKED',
    );

    let v = (await owner.get(`/v1/employees/${leaver.id}`)).body.version as number;
    const notice = await owner.send('post', `/v1/employees/${leaver.id}/lifecycle`, {
      action: 'notice',
      version: v,
      noticeGivenOn: '2026-05-01',
      lastWorkingDay: '2026-05-31',
      exitReasonId: look.resigned,
    });
    expect(notice.body).toMatchObject({ status: 'ON_NOTICE', lastWorkingDay: '2026-05-31' });
    v = notice.body.version;

    const blocked = await owner.send('post', `/v1/employees/${leaver.id}/lifecycle`, {
      action: 'exit',
      version: v,
      exitedOn: '2026-05-31',
      exitReasonId: look.resigned,
    });
    expect(blocked.body.code).toBe('HAS_REPORTS');
    await owner.send('post', `/v1/employees/${report.id}/lifecycle`, {
      action: 'change_manager',
      version: 1,
      effectiveDate: '2026-05-20',
      managerId: null,
    });
    const exit = await owner.send('post', `/v1/employees/${leaver.id}/lifecycle`, {
      action: 'exit',
      version: v,
      exitedOn: '2026-05-31',
      exitReasonId: look.resigned,
    });
    expect(exit.body).toMatchObject({
      status: 'EXITED',
      exitedOn: '2026-05-31',
      signIn: { status: 'SUSPENDED' },
    });
    expect((await db.tenantMembership.findUniqueOrThrow({ where: { id: membershipId } })).status).toBe(
      'SUSPENDED',
    );
    // Leavers are kept, but not listed among current employees, and don't count towards the plan.
    const current = (await owner.get('/v1/employees?pageSize=200')).body.items as { id: string }[];
    expect(current.map((e) => e.id)).not.toContain(leaver.id);
    const leavers = (await owner.get(`/v1/employees?status=EXITED`)).body.items as { id: string }[];
    expect(leavers.map((e) => e.id)).toContain(leaver.id);
  });
});

describe('identity and bank details', () => {
  it('stores numbers encrypted, shows them masked, and reveals them only after a recent password entry', async () => {
    const e = await hire({ firstName: 'Secret' });
    const save = await owner.send('put', `/v1/employees/${e.id}/sensitive`, {
      pan: 'ABCDE1234F',
      bankAccount: '001234567890',
      bankIfsc: 'HDFC0001234',
    });
    expect(save.status).toBe(200);
    expect(save.body).toMatchObject({
      pan: '•••• 234F',
      bankAccount: '•••• 7890',
      aadhaar: null,
      bankIfsc: 'HDFC0001234',
    });

    const row = await db.employeeSensitive.findUniqueOrThrow({ where: { employeeId: e.id } });
    expect(JSON.stringify(row)).not.toContain('ABCDE1234F');
    expect(JSON.stringify(row)).not.toContain('001234567890');

    await db.userSession.updateMany({ where: { userId: ownerId }, data: { reauthenticatedAt: null } });
    expect((await owner.send('post', `/v1/employees/${e.id}/sensitive/reveal`)).body.code).toBe(
      'REAUTH_REQUIRED',
    );
    await owner.send('post', '/v1/auth/reauthenticate', { password: 'violet harbour sunrise 42' });
    const revealed = await owner.send('post', `/v1/employees/${e.id}/sensitive/reveal`);
    expect(revealed.body).toMatchObject({ pan: 'ABCDE1234F', bankAccount: '001234567890' });
    const audits = await db.auditEvent.findMany({
      where: { targetId: e.id, action: { startsWith: 'employee.sensitive' } },
    });
    expect(audits.map((a) => a.action).sort()).toEqual([
      'employee.sensitive.reveal',
      'employee.sensitive.update',
    ]);
    expect(JSON.stringify(audits)).not.toContain('ABCDE1234F');

    // Clearing one field leaves the others.
    const cleared = await owner.send('put', `/v1/employees/${e.id}/sensitive`, { pan: null });
    expect(cleared.body).toMatchObject({ pan: null, bankAccount: '•••• 7890' });
  });

  it('binds each value to its employee: a value copied to another record can’t be read', async () => {
    const a = await hire({ firstName: 'Source' });
    const b = await hire({ firstName: 'Target' });
    await owner.send('put', `/v1/employees/${a.id}/sensitive`, { pan: 'ABCDE1234F' });
    await owner.send('put', `/v1/employees/${b.id}/sensitive`, { pan: 'PQRSX9876Z' });
    const sealed = (await db.employeeSensitive.findUniqueOrThrow({ where: { employeeId: a.id } })).panSealed;
    await db.employeeSensitive.update({ where: { employeeId: b.id }, data: { panSealed: sealed } });
    const res = await owner.send('post', `/v1/employees/${b.id}/sensitive/reveal`);
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('SENSITIVE_UNREADABLE');
    expect(JSON.stringify(res.body)).not.toContain('ABCDE1234F');
    // The export leaves the unreadable value out instead of failing.
    await owner.send('post', '/v1/auth/reauthenticate', { password: 'violet harbour sunrise 42' });
    const exported = (
      JSON.parse((await owner.get('/v1/tenant/export')).text) as { sections: Record<string, unknown[]> }
    ).sections;
    expect(exported.employeeIdentityAndBank).toEqual(
      expect.arrayContaining([expect.objectContaining({ employeeId: b.id, pan: null, unreadable: ['pan'] })]),
    );
  });

  it('is invisible to people without the permission', async () => {
    const e = await hire({ firstName: 'Private' });
    const viewer = await memberWith('just-view', ['employees.view'], { type: 'COMPANY', id: org.acme });
    expect((await viewer.get(`/v1/employees/${e.id}`)).body.can).toMatchObject({
      viewSensitive: false,
      manage: false,
    });
    expect((await viewer.get(`/v1/employees/${e.id}/sensitive`)).status).toBe(403);
  });
});

describe('emergency contacts', () => {
  it('keeps one primary contact', async () => {
    const e = await hire({ firstName: 'Contacts' });
    const add = (name: string, isPrimary: boolean) =>
      owner.send('post', `/v1/employees/${e.id}/contacts`, {
        name,
        relationship: 'Sibling',
        phone: '+91 90000 00001',
        isPrimary,
      });
    const first = await add('Anil', true);
    await add('Bina', true);
    const list = (await owner.get(`/v1/employees/${e.id}/contacts`)).body as {
      name: string;
      isPrimary: boolean;
    }[];
    expect(list.map((c) => [c.name, c.isPrimary])).toEqual([
      ['Bina', true],
      ['Anil', false],
    ]);
    expect((await owner.send('delete', `/v1/employees/${e.id}/contacts/${first.body.id}`)).status).toBe(204);
    expect((await owner.get(`/v1/employees/${e.id}/contacts`)).body).toHaveLength(1);
  });
});

describe('import', () => {
  const header =
    'employee_code,first_name,last_name,work_email,date_of_joining,company_code,branch_code,department_code,designation_code,manager_code';
  const acme = () => `ACME-${fx.run}`.toUpperCase();
  const hyd = () => `HYD-${fx.run}`.toUpperCase();

  it('reports every problem in a dry run and changes nothing', async () => {
    const before = await db.employee.count({ where: { tenantId } });
    const csv = [
      header,
      `IMP-1,Asha,Rao,asha.imp@acme.example,2026-01-05,${acme()},${hyd()},,NURSE,`,
      `IMP-1,Ravi,Kumar,,2026-01-05,${acme()},,,,`,
      `IMP-3,Bad,Company,,2026-01-05,NOPE,,,,`,
      `IMP-4,Bad,Designation,,2026-02-30,${acme()},,,ASTRONAUT,`,
      `IMP-5,Loop,One,,2026-01-05,${acme()},,,,IMP-6`,
      `IMP-6,Loop,Two,,2026-01-05,${acme()},,,,IMP-5`,
    ].join('\n');
    const res = await owner.send('post', '/v1/employees/import', { csv, dryRun: true });
    expect(res.status).toBe(200);
    const problems = res.body.problems as { row: number; column: string }[];
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 3, column: 'employee_code' }),
        expect.objectContaining({ row: 4, column: 'company_code' }),
        expect.objectContaining({ row: 5, column: 'date_of_joining' }),
        expect.objectContaining({ row: 6, column: 'manager_code' }),
      ]),
    );
    expect(await db.employee.count({ where: { tenantId } })).toBe(before);
    // A real run with problems also changes nothing.
    expect((await owner.send('post', '/v1/employees/import', { csv, dryRun: false })).body.created).toBe(0);
    expect(await db.employee.count({ where: { tenantId } })).toBe(before);
  });

  it('imports every row in one go, linking managers inside the file', async () => {
    const csv = [
      header,
      `IMP-20,Lakshmi,Pillai,lakshmi.imp@acme.example,2026-01-05,${acme()},${hyd()},,NURSE,`,
      `IMP-21,Vikram,Das,,2026-01-06,${acme()},,,,IMP-20`,
      `,Auto,Numbered,,2026-01-07,${acme()},,,,IMP-20`,
    ].join('\r\n');
    const res = await owner.send('post', '/v1/employees/import', { csv, dryRun: false });
    expect(res.body).toMatchObject({ created: 3, problemCount: 0 });
    const lead = await db.employee.findFirstOrThrow({ where: { tenantId, employeeCode: 'IMP-20' } });
    expect(await db.employee.count({ where: { tenantId, managerId: lead.id } })).toBe(2);
    expect(lead.designationId).toBe(look.nurse);
  });

  it('refuses files with missing or unknown columns', async () => {
    const res = await owner.send('post', '/v1/employees/import', {
      csv: 'first_name,salary\nA,1',
      dryRun: true,
    });
    expect(res.body.code).toBe('CSV_COLUMNS');
    expect(res.body.detail).toMatch(/last_name/);
    expect(res.body.detail).toMatch(/salary/);
  });
});

describe('plan', () => {
  it('stops adding employees at the plan limit and refuses the module when the plan lacks it', async () => {
    const current = await db.employee.count({ where: { tenantId, status: { not: 'EXITED' } } });
    const override = await db.entitlementOverride.create({
      data: {
        tenantId,
        kind: 'LIMIT',
        key: 'employees.max',
        value: current,
        reason: 'test',
        createdByUserId: ownerId,
      },
    });
    const res = await owner.send('post', '/v1/employees', base());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('LIMIT_REACHED');
    await db.entitlementOverride.delete({ where: { id: override.id } });

    const off = await db.entitlementOverride.create({
      data: {
        tenantId,
        kind: 'FEATURE',
        key: 'hr.core',
        enabled: false,
        reason: 'test',
        createdByUserId: ownerId,
      },
    });
    expect((await owner.get('/v1/employees')).body.code).toBe('ENTITLEMENT_REQUIRED');
    await db.entitlementOverride.delete({ where: { id: off.id } });
  });
});

describe('export', () => {
  it('includes employees, their history and readable identity details', async () => {
    const e = await hire({ firstName: 'Exported' });
    await owner.send('put', `/v1/employees/${e.id}/sensitive`, { pan: 'ZZZZZ9999Z' });
    await owner.send('post', '/v1/auth/reauthenticate', { password: 'violet harbour sunrise 42' });
    const res = await owner.get('/v1/tenant/export');
    expect(res.status).toBe(200);
    const data = (JSON.parse(res.text) as { sections: Record<string, unknown[]> }).sections;
    expect((data.employees as { id: string }[]).some((x) => x.id === e.id)).toBe(true);
    expect((data.employeeHistory as unknown[]).length).toBeGreaterThan(0);
    expect(data.employeeIdentityAndBank).toEqual(
      expect.arrayContaining([expect.objectContaining({ employeeId: e.id, pan: 'ZZZZZ9999Z' })]),
    );
    expect(res.text).not.toContain('Sealed');
  });
});
