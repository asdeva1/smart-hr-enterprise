/**
 * Organisation structure, roles and permissions through the real API, database and Redis.
 * Each test sets up the people it needs, so it reads as a scenario.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiEnv } from '../src/config/env.js';
import {
  Browser,
  DEFAULT_PASSWORD,
  Fixtures,
  ownerClient,
  queuedEmails,
  resetTokenFrom,
  startApp,
  testEnv,
} from './helpers.js';

let env: ApiEnv;
let app: NestExpressApplication;
const db = ownerClient();
const fx = new Fixtures(db);

beforeAll(async () => {
  env = testEnv();
  app = await startApp(env);
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await db.$disconnect();
});

/** A tenant with a signed-in owner, plus helpers to add people with roles. */
async function organisation(name = 'Org') {
  const tenant = await fx.tenant(name);
  const ownerUser = await fx.user(`${name}-owner`);
  await fx.member(tenant.id, ownerUser.id, true);
  const owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);

  async function person(
    label: string,
    roles: {
      key?: Parameters<Fixtures['systemRole']>[1];
      roleId?: string;
      scope?: { type: 'TENANT' | 'COMPANY' | 'BRANCH' | 'DEPARTMENT'; id: string };
    }[] = [],
  ) {
    const user = await fx.user(`${name}-${label}`);
    const membership = await fx.member(tenant.id, user.id);
    for (const r of roles) {
      const roleId = r.roleId ?? (await fx.systemRole(tenant.id, r.key!));
      await fx.assign(tenant.id, membership.id, roleId, r.scope);
    }
    const browser = new Browser(app);
    expect((await browser.login(user.email)).status).toBe(200);
    return { user, membership, browser };
  }
  return { tenant, ownerUser, owner, person };
}

const company = (code: string) => ({
  code,
  name: `${code} Pvt Ltd`,
  country: 'in',
  baseCurrency: 'inr',
  timezone: 'Asia/Kolkata',
});

describe('permissions', () => {
  it('refuses a member with no roles and admits one with the needed permission', async () => {
    const org = await organisation('Perm');
    const nobody = await org.person('nobody');
    expect((await nobody.browser.get('/v1/org/companies')).status).toBe(403);

    const viewer = await org.person('viewer', [{ key: 'member' }]);
    expect((await viewer.browser.get('/v1/org/companies')).status).toBe(200);
    // org.view does not include org.manage.
    const create = await viewer.browser.send('post', '/v1/org/companies', company(`V${fx.run}`));
    expect(create.status).toBe(403);
    expect(create.body.code).toBe('FORBIDDEN');
  });

  it('lists permissions in the session for the web app to shape its menus', async () => {
    const org = await organisation('Menu');
    const auditor = await org.person('auditor', [{ key: 'auditor' }]);
    const view = (await auditor.browser.get('/v1/auth/session')).body;
    expect([...(view.activeTenant.permissions as string[])].sort()).toEqual([
      'access.view',
      'approvals.view_all',
      'attendance.view',
      'audit.view',
      'employees.view',
      'org.view',
    ]);
    const ownerView = (await org.owner.get('/v1/auth/session')).body;
    expect(ownerView.activeTenant.permissions).toContain('access.manage');
  });

  it('takes a removed role away on the very next request', async () => {
    const org = await organisation('Revoke');
    const viewer = await org.person('viewer', [{ key: 'member' }]);
    expect((await viewer.browser.get('/v1/org/companies')).status).toBe(200);
    await db.roleAssignment.deleteMany({ where: { membershipId: viewer.membership.id } });
    expect((await viewer.browser.get('/v1/org/companies')).status).toBe(403);
  });
});

describe('organisation structure', () => {
  it('lets an owner build companies, branches and nested departments', async () => {
    const org = await organisation('Build');
    const c = await org.owner.send('post', '/v1/org/companies', company(`acme-${fx.run}`));
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({
      code: `ACME-${fx.run}`.toUpperCase(),
      country: 'IN',
      baseCurrency: 'INR',
    });

    const b = await org.owner.send('post', '/v1/org/branches', {
      companyId: c.body.id,
      code: `blr-${fx.run}`,
      name: 'Bengaluru',
      city: 'Bengaluru',
    });
    expect(b.status).toBe(201);

    const parent = await org.owner.send('post', '/v1/org/departments', {
      companyId: c.body.id,
      code: `ops-${fx.run}`,
      name: 'Operations',
    });
    const child = await org.owner.send('post', '/v1/org/departments', {
      companyId: c.body.id,
      parentId: parent.body.id,
      code: `coding-${fx.run}`,
      name: 'Medical coding',
    });
    expect(child.status).toBe(201);
    expect(child.body.parentId).toBe(parent.body.id);

    // A department can't be moved under its own child.
    const cycle = await org.owner.send('patch', `/v1/org/departments/${parent.body.id}`, {
      parentId: child.body.id,
    });
    expect(cycle.status).toBe(400);
    expect(cycle.body.code).toBe('DEPARTMENT_CYCLE');

    // Codes are unique within the organisation.
    const dup = await org.owner.send('post', '/v1/org/companies', company(`acme-${fx.run}`));
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('CODE_TAKEN');

    // A company with active branches can't be archived.
    const archive = await org.owner.send('patch', `/v1/org/companies/${c.body.id}`, { status: 'ARCHIVED' });
    expect(archive.status).toBe(409);

    const audit = await db.auditEvent.findMany({
      where: { tenantId: org.tenant.id, action: { startsWith: 'org.' } },
      select: { action: true },
    });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['org.company.create', 'org.branch.create', 'org.department.create']),
    );
  });

  it('confines a company-scoped manager to that company', async () => {
    const org = await organisation('Scope');
    const a = await fx.company(org.tenant.id, 'scope-a');
    const b = await fx.company(org.tenant.id, 'scope-b');
    const managerRole = await fx.customRole(org.tenant.id, 'Company manager', ['org.view', 'org.manage']);
    const manager = await org.person('manager', [
      { roleId: managerRole, scope: { type: 'COMPANY', id: a.id } },
    ]);

    const listed = await manager.browser.get('/v1/org/companies');
    expect((listed.body as { id: string }[]).map((x) => x.id)).toEqual([a.id]);

    const inA = await manager.browser.send('post', '/v1/org/branches', {
      companyId: a.id,
      code: `in-a-${fx.run}`,
      name: 'In A',
    });
    expect(inA.status).toBe(201);
    const inB = await manager.browser.send('post', '/v1/org/branches', {
      companyId: b.id,
      code: `in-b-${fx.run}`,
      name: 'In B',
    });
    expect(inB.status).toBe(403);
    // Creating a whole new company needs tenant-wide org.manage.
    expect((await manager.browser.send('post', '/v1/org/companies', company(`new-${fx.run}`))).status).toBe(
      403,
    );
    // Renaming the other company is refused too.
    expect(
      (await manager.browser.send('patch', `/v1/org/companies/${b.id}`, { name: 'Taken over' })).status,
    ).toBe(403);
  });
});

describe('tenant isolation of organisation and access records', () => {
  it('answers another tenant’s ids with 404, never their data', async () => {
    const orgA = await organisation('IsoA');
    const orgB = await organisation('IsoB');
    const companyA = await fx.company(orgA.tenant.id, 'iso-a');
    const memberA = await orgA.person('someone', [{ key: 'member' }]);

    expect(
      (await orgB.owner.send('patch', `/v1/org/companies/${companyA.id}`, { name: 'Mine now' })).status,
    ).toBe(404);
    expect((await orgB.owner.get(`/v1/admin/members/${memberA.membership.id}`)).status).toBe(404);

    // Using tenant A's role or company id in tenant B is refused.
    const roleA = await fx.systemRole(orgA.tenant.id, 'org_admin');
    const memberB = await orgB.person('target');
    const grant = await orgB.owner.send('post', `/v1/admin/members/${memberB.membership.id}/assignments`, {
      roleId: roleA,
      scopeType: 'TENANT',
    });
    expect(grant.status).toBe(404);
    const roleB = await fx.systemRole(orgB.tenant.id, 'member');
    const foreignScope = await orgB.owner.send(
      'post',
      `/v1/admin/members/${memberB.membership.id}/assignments`,
      {
        roleId: roleB,
        scopeType: 'COMPANY',
        scopeId: companyA.id,
      },
    );
    expect(foreignScope.status).toBe(404);

    expect((await db.company.findUnique({ where: { id: companyA.id } }))?.name).toBe('iso-a');
  });
});

describe('privilege escalation', () => {
  it('stops an access administrator granting more than they hold', async () => {
    const org = await organisation('Esc');
    const admin = await org.person('access-admin', [{ key: 'access_admin' }]);
    const target = await org.person('target');

    const orgAdminRole = await fx.systemRole(org.tenant.id, 'org_admin');
    const tooMuch = await admin.browser.send(
      'post',
      `/v1/admin/members/${target.membership.id}/assignments`,
      {
        roleId: orgAdminRole,
        scopeType: 'TENANT',
      },
    );
    expect(tooMuch.status).toBe(403);
    expect(tooMuch.body.code).toBe('ROLE_EXCEEDS_YOUR_ACCESS');

    const memberRole = await fx.systemRole(org.tenant.id, 'member');
    const ok = await admin.browser.send('post', `/v1/admin/members/${target.membership.id}/assignments`, {
      roleId: memberRole,
      scopeType: 'TENANT',
    });
    expect(ok.status).toBe(201);

    // A custom role can't smuggle in permissions the editor doesn't hold.
    const role = await admin.browser.send('post', '/v1/admin/roles', {
      name: 'Sneaky',
      permissions: ['org.view', 'org.manage'],
    });
    expect(role.status).toBe(403);
    // Nor can it contain made-up permissions.
    const fake = await org.owner.send('post', '/v1/admin/roles', {
      name: 'Fake',
      permissions: ['payroll.godmode'],
    });
    expect(fake.status).toBe(400);
    expect(fake.body.code).toBe('UNKNOWN_PERMISSION');
  });

  it('stops anyone but an owner changing their own roles or ownership', async () => {
    const org = await organisation('Self');
    const admin = await org.person('access-admin', [{ key: 'access_admin' }]);
    const auditorRole = await fx.systemRole(org.tenant.id, 'auditor');

    const self = await admin.browser.send('post', `/v1/admin/members/${admin.membership.id}/assignments`, {
      roleId: auditorRole,
      scopeType: 'TENANT',
    });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('CANNOT_CHANGE_SELF');

    const promote = await admin.browser.send('patch', `/v1/admin/members/${admin.membership.id}`, {
      isTenantAdmin: true,
    });
    expect(promote.status).toBe(403);
    expect(
      (await db.tenantMembership.findUnique({ where: { id: admin.membership.id } }))?.isTenantAdmin,
    ).toBe(false);
  });

  it('keeps at least one active owner', async () => {
    const org = await organisation('LastOwner');
    const ownerMembership = await db.tenantMembership.findFirstOrThrow({
      where: { tenantId: org.tenant.id, userId: org.ownerUser.id },
    });
    const res = await org.owner.send('patch', `/v1/admin/members/${ownerMembership.id}`, {
      isTenantAdmin: false,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LAST_OWNER');
  });

  it('protects built-in roles and roles that are in use', async () => {
    const org = await organisation('Roles');
    const auditorRole = await fx.systemRole(org.tenant.id, 'auditor');
    expect(
      (await org.owner.send('patch', `/v1/admin/roles/${auditorRole}`, { permissions: [] })).status,
    ).toBe(409);

    const custom = await org.owner.send('post', '/v1/admin/roles', {
      name: 'Viewer',
      permissions: ['org.view'],
    });
    expect(custom.status).toBe(201);
    await org.person('holder', [{ roleId: custom.body.id }]);
    const del = await org.owner.send('delete', `/v1/admin/roles/${custom.body.id}`);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('ROLE_IN_USE');
  });
});

describe('members', () => {
  it('suspending a member cuts off access at once; reactivating restores it', async () => {
    const org = await organisation('Suspend');
    const admin = await org.person('access-admin', [{ key: 'access_admin' }]);
    const worker = await org.person('worker', [{ key: 'member' }]);

    expect(
      (
        await admin.browser.send('patch', `/v1/admin/members/${worker.membership.id}`, {
          status: 'SUSPENDED',
        })
      ).status,
    ).toBe(200);
    expect((await worker.browser.get('/v1/org/companies')).status).toBe(403);

    await admin.browser.send('patch', `/v1/admin/members/${worker.membership.id}`, { status: 'ACTIVE' });
    expect((await worker.browser.get('/v1/org/companies')).status).toBe(200);

    // Nobody suspends themselves.
    const selfSuspend = await admin.browser.send('patch', `/v1/admin/members/${admin.membership.id}`, {
      status: 'SUSPENDED',
    });
    expect(selfSuspend.status).toBe(400);
  });

  it('invites a new person, who sets a password from the email and signs in with their role', async () => {
    const org = await organisation('Invite');
    const memberRole = await fx.systemRole(org.tenant.id, 'member');
    const email = `invitee-${fx.run}@test.local`;

    const invited = await org.owner.send('post', '/v1/admin/members', {
      email,
      displayName: 'New Person',
      assignments: [{ roleId: memberRole, scopeType: 'TENANT' }],
    });
    expect(invited.status).toBe(201);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).toBeNull();
    fx.trackUser(user.id);

    // Signing in before accepting fails like any wrong password.
    expect((await new Browser(app).login(email)).status).toBe(401);

    const [mail] = await queuedEmails(env, email);
    expect(mail?.subject).toContain('invited you');
    expect(mail?.text).toContain('invite=1');
    const token = resetTokenFrom(mail!);
    const stored = await db.passwordResetToken.findFirstOrThrow({ where: { userId: user.id, usedAt: null } });
    expect(stored.purpose).toBe('INVITATION');
    expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(70 * 3_600_000);

    const accept = await new Browser(app).send('post', '/v1/auth/password/reset', {
      token,
      newPassword: DEFAULT_PASSWORD,
    });
    expect(accept.status).toBe(204);

    const invitee = new Browser(app);
    const login = await invitee.login(email);
    expect(login.status).toBe(200);
    expect(login.body.activeTenant.permissions).toEqual(['org.view']);

    // Inviting the same person again is refused.
    const again = await org.owner.send('post', '/v1/admin/members', { email, displayName: 'Again' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_MEMBER');
  });
});

describe('organisation security policy', () => {
  it('requires two-step verification for members once switched on', async () => {
    const org = await organisation('Mfa');
    // The owner can't require it before turning it on themselves.
    const early = await org.owner.send('put', '/v1/admin/security', { requireMfa: true });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('ENABLE_MFA_FIRST');

    const worker = await org.person('worker', [{ key: 'member' }]);
    await db.tenant.update({ where: { id: org.tenant.id }, data: { requireMfa: true } });

    const blocked = await worker.browser.get('/v1/org/companies');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('MFA_ENROLMENT_REQUIRED');
    // Their own account pages still work, so they can turn it on.
    const session = await worker.browser.get('/v1/auth/session');
    expect(session.status).toBe(200);
    expect(session.body.activeTenant.mfaEnrolmentRequired).toBe(true);

    await db.user.update({ where: { id: worker.user.id }, data: { mfaEnabledAt: new Date() } });
    expect((await worker.browser.get('/v1/org/companies')).status).toBe(200);
  });
});

describe('audit log', () => {
  it('shows role changes to auditors and nobody without audit.view', async () => {
    const org = await organisation('Audit');
    const target = await org.person('target');
    const memberRole = await fx.systemRole(org.tenant.id, 'member');
    await org.owner.send('post', `/v1/admin/members/${target.membership.id}/assignments`, {
      roleId: memberRole,
      scopeType: 'TENANT',
    });

    const auditor = await org.person('auditor', [{ key: 'auditor' }]);
    const log = await auditor.browser.get('/v1/admin/audit?action=access.role');
    expect(log.status).toBe(200);
    const items = (log.body as { items: { action: string }[] }).items;
    const assign = items.find((e) => e.action === 'access.role.assign');
    expect(assign).toMatchObject({ targetId: target.membership.id, actor: { displayName: 'Audit-owner' } });

    expect((await target.browser.get('/v1/admin/audit')).status).toBe(403);
  });
});
