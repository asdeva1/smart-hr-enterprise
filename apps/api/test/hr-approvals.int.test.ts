/**
 * Approvals in the HR modules through the real API and database: employment changes that wait for approval
 * when the organisation asks for it (applied only once approved, checked again then), and employees hearing
 * about leave someone else asked for on their behalf.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDatabaseClient, withTenant } from '@smart-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate, weekday } from '../src/attendance/attendance-calc.js';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import { Browser, Fixtures, ownerClient, requireEnv, startApp, testEnv } from './helpers.js';

const db = ownerClient();
const runtime = createDatabaseClient({ connectionString: requireEnv('DATABASE_URL'), maxConnections: 2 });
const fx = new Fixtures(db);
let app: NestExpressApplication;
let tenantId: string;
let owner: Browser;
let acme: string;
let nurseDesignation: string;
let seniorDesignation: string;
let resigned: string;

interface Person {
  employeeId: string;
  browser: Browser;
  membershipId: string;
}

async function person(
  label: string,
  opts: { managerId?: string; permissions?: string[] } = {},
): Promise<Person> {
  const user = await fx.user(label);
  const m = await fx.member(tenantId, user.id);
  if (opts.permissions) {
    await fx.assign(tenantId, m.id, await fx.customRole(tenantId, label, opts.permissions), {
      type: 'TENANT',
      id: tenantId,
    });
  }
  const res = await owner.send('post', '/v1/employees', {
    firstName: label,
    lastName: 'Test',
    companyId: acme,
    dateOfJoining: '2025-01-01',
    designationId: nurseDesignation,
    ...(opts.managerId ? { managerId: opts.managerId } : {}),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await db.employee.update({ where: { id: res.body.id }, data: { membershipId: m.id } });
  const browser = new Browser(app);
  expect((await browser.login(user.email)).status).toBe(200);
  return { employeeId: res.body.id as string, browser, membershipId: m.id };
}

async function ownerTask(approvalRequestId: string) {
  const inbox = (await owner.get('/v1/approvals/inbox')).body as { id: string; request: { id: string } }[];
  return inbox.find((t) => t.request.id === approvalRequestId);
}

let hr: Person;
let nurse: Person;
let manager: Person;

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  const tenant = await fx.tenant('HR approvals');
  tenantId = tenant.id;
  const ownerUser = await fx.user('hra-owner');
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  acme = (await fx.company(tenantId, 'ACME')).id;
  const designation = async (code: string, name: string) => {
    const res = await owner.send('post', '/v1/master-data/designation', { code, name });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };
  nurseDesignation = await designation('NURSE', 'Staff nurse');
  seniorDesignation = await designation('SNURSE', 'Senior nurse');
  const reason = await owner.send('post', '/v1/master-data/exit_reason', {
    code: 'RESIGNED',
    name: 'Resigned',
  });
  expect(reason.status, JSON.stringify(reason.body)).toBe(201);
  resigned = reason.body.id as string;
  manager = await person('hra-manager');
  nurse = await person('hra-nurse', { managerId: manager.employeeId });
  hr = await person('hra-hr', {
    permissions: ['employees.view', 'employees.manage', 'employees.lifecycle', 'leave.view', 'leave.manage'],
  });
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await runtime.$disconnect();
  await db.$disconnect();
});

const version = async (employeeId: string) =>
  (await db.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { version: true } })).version;

describe('employment changes', () => {
  it('take effect straight away by default', async () => {
    const res = await hr.browser.send('post', `/v1/employees/${manager.employeeId}/lifecycle`, {
      action: 'promotion',
      version: await version(manager.employeeId),
      effectiveDate: '2026-04-01',
      designationId: seniorDesignation,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.designation).toMatchObject({ name: 'Senior nurse' });
    expect(res.body.pendingChange).toBeUndefined();
  });

  it('wait for approval when the organisation asks, and are applied only once approved', async () => {
    const setting = await owner.send('put', '/v1/tenant/configuration', {
      values: { employment_changes: 'APPROVAL' },
    });
    expect(setting.status, JSON.stringify(setting.body)).toBe(200);

    const res = await hr.browser.send('post', `/v1/employees/${nurse.employeeId}/lifecycle`, {
      action: 'promotion',
      version: await version(nurse.employeeId),
      effectiveDate: '2026-05-01',
      designationId: seniorDesignation,
      note: 'Passed the senior nurse assessment',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.designation).toMatchObject({ name: 'Staff nurse' });
    expect(res.body.pendingChange).toMatchObject({
      status: 'PENDING',
      action: 'promotion',
      effectiveDate: '2026-05-01',
      changes: { designation: { from: 'Staff nurse', to: 'Senior nurse' } },
    });
    const changeId = res.body.pendingChange.id as string;
    expect(await db.employeeEvent.count({ where: { employeeId: nurse.employeeId, kind: 'PROMOTION' } })).toBe(
      0,
    );

    // One open change at a time.
    const second = await hr.browser.send('post', `/v1/employees/${nurse.employeeId}/lifecycle`, {
      action: 'change_manager',
      version: await version(nurse.employeeId),
      effectiveDate: '2026-05-01',
      managerId: null,
    });
    expect(second.body.code).toBe('CHANGE_PENDING');

    // The employee's page lists it; the employee isn't told about employment changes.
    const listed = (await hr.browser.get(`/v1/employees/${nurse.employeeId}/changes`)).body as {
      id: string;
    }[];
    expect(listed.map((c) => c.id)).toEqual([changeId]);
    const nurseNotes = (await nurse.browser.get('/v1/notifications')).body as { unread: number };
    expect(nurseNotes.unread).toBe(0);

    // The owners approve by default.
    const task = await ownerTask(res.body.pendingChange.approvalRequest.id as string);
    expect(task).toBeDefined();
    expect((await owner.get(`/v1/employee-changes/${changeId}`)).body.status).toBe('PENDING');
    const decided = await owner.send('post', `/v1/approvals/tasks/${task!.id}/decision`, {
      decision: 'APPROVE',
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);

    const after = (await hr.browser.get(`/v1/employees/${nurse.employeeId}`)).body;
    expect(after.designation).toMatchObject({ name: 'Senior nurse' });
    const event = await db.employeeEvent.findFirstOrThrow({
      where: { employeeId: nurse.employeeId, kind: 'PROMOTION' },
    });
    expect(event).toMatchObject({ note: 'Passed the senior nurse assessment' });
    expect(event.effectiveDate.toISOString().slice(0, 10)).toBe('2026-05-01');
    expect((await hr.browser.get(`/v1/employee-changes/${changeId}`)).body.status).toBe('APPROVED');
  });

  it('change nothing when rejected or withdrawn', async () => {
    const ask = async () =>
      hr.browser.send('post', `/v1/employees/${nurse.employeeId}/lifecycle`, {
        action: 'notice',
        version: await version(nurse.employeeId),
        noticeGivenOn: '2026-06-01',
        lastWorkingDay: '2026-07-31',
      });
    const first = await ask();
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const task = await ownerTask(first.body.pendingChange.approvalRequest.id as string);
    await owner.send('post', `/v1/approvals/tasks/${task!.id}/decision`, {
      decision: 'REJECT',
      comment: 'Not agreed',
    });
    expect((await db.employee.findUniqueOrThrow({ where: { id: nurse.employeeId } })).status).toBe('ACTIVE');
    expect((await hr.browser.get(`/v1/employee-changes/${first.body.pendingChange.id}`)).body).toMatchObject({
      status: 'REJECTED',
      decisionNote: 'Not agreed',
    });

    const second = await ask();
    // Only whoever asked can withdraw it.
    expect(
      (await owner.send('post', `/v1/employee-changes/${second.body.pendingChange.id}/cancel`)).status,
    ).toBe(404);
    const withdrawn = await hr.browser.send(
      'post',
      `/v1/employee-changes/${second.body.pendingChange.id}/cancel`,
    );
    expect(withdrawn.body.status).toBe('CANCELLED');
    expect((await db.employee.findUniqueOrThrow({ where: { id: nurse.employeeId } })).status).toBe('ACTIVE');

    // A decided change is final in the database too.
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.employeeChangeRequest.update({
          where: { id: second.body.pendingChange.id as string },
          data: { status: 'PENDING' },
        }),
      ),
    ).rejects.toThrow(/already cancelled/);
  });

  it('are checked again when approved, and refused if they can no longer be made', async () => {
    const res = await hr.browser.send('post', `/v1/employees/${manager.employeeId}/lifecycle`, {
      action: 'exit',
      version: await version(manager.employeeId),
      exitedOn: '2026-08-31',
      exitReasonId: resigned,
    });
    // An exit is refused up front while people report to them.
    expect(res.body.code).toBe('HAS_REPORTS');

    const ok = await hr.browser.send('post', `/v1/employees/${nurse.employeeId}/lifecycle`, {
      action: 'change_manager',
      version: await version(nurse.employeeId),
      effectiveDate: '2026-09-01',
      managerId: null,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    // Meanwhile the nurse's manager is removed some other way, so "remove the manager" changes nothing.
    await db.employee.update({ where: { id: nurse.employeeId }, data: { managerId: null } });
    const task = await ownerTask(ok.body.pendingChange.approvalRequest.id as string);
    const decided = await owner.send('post', `/v1/approvals/tasks/${task!.id}/decision`, {
      decision: 'APPROVE',
    });
    expect(decided.status).toBe(409);
    expect(decided.body.code).toBe('CHANGE_NO_LONGER_POSSIBLE');
    expect((await hr.browser.get(`/v1/employee-changes/${ok.body.pendingChange.id}`)).body.status).toBe(
      'PENDING',
    );
    await hr.browser.send('post', `/v1/employee-changes/${ok.body.pendingChange.id}/cancel`);
    await db.employee.update({ where: { id: nurse.employeeId }, data: { managerId: manager.employeeId } });
  });
});

describe('telling the employee', () => {
  it('tells someone when leave is asked for on their behalf, and when it is decided', async () => {
    const type = await owner.send('post', '/v1/leave/types', {
      code: 'CL',
      name: 'Casual leave',
      quotaDays: 12,
    });
    expect(type.status).toBe(201);
    let day = addDays(localDate(new Date(), 'Asia/Kolkata'), 10);
    while (weekday(day) === 0) day = addDays(day, 1);
    const leave = await hr.browser.send('post', '/v1/leave/requests', {
      employeeId: nurse.employeeId,
      leaveTypeId: type.body.id,
      from: day,
      to: day,
      reason: 'Recorded by HR after a phone call',
    });
    expect(leave.status, JSON.stringify(leave.body)).toBe(201);
    const notes = async () =>
      (await nurse.browser.get('/v1/notifications')).body as { items: { category: string; title: string }[] };
    expect((await notes()).items[0]).toMatchObject({
      category: 'request.about_me',
      title: expect.stringMatching(/asked for this for you/),
    });

    // The manager decides; the nurse hears the outcome, HR (who asked) hears as the requester.
    const inbox = (await manager.browser.get('/v1/approvals/inbox')).body as {
      id: string;
      request: { id: string };
    }[];
    const task = inbox.find((t) => t.request.id === leave.body.approvalRequest.id);
    await manager.browser.send('post', `/v1/approvals/tasks/${task!.id}/decision`, { decision: 'APPROVE' });
    expect((await notes()).items[0]).toMatchObject({
      category: 'request.about_me',
      title: 'A request for you was approved',
    });
    const hrNotes = (await hr.browser.get('/v1/notifications')).body as { items: { category: string }[] };
    expect(hrNotes.items[0]?.category).toBe('approval.decided');

    // Asking for oneself doesn't send the extra notification.
    const before = (await notes()).items.length;
    let later = addDays(day, 7);
    while (weekday(later) === 0) later = addDays(later, 1);
    const own = await nurse.browser.send('post', '/v1/leave/requests', {
      leaveTypeId: type.body.id,
      from: later,
      to: later,
      reason: 'Errand',
    });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    expect((await notes()).items.length).toBe(before);
  });
});
