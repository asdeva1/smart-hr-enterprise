/**
 * Attendance through the real API and database: clocking in and out, daily results in the employee's time
 * zone, shifts and assignments, recording on someone's behalf, who sees whom (scopes and reporting line),
 * corrections through the approval engine with the reporting manager as approver, and the plan gate.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate, weekday } from '../src/attendance/attendance-calc.js';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import { Browser, Fixtures, ownerClient, startApp, testEnv } from './helpers.js';

const db = ownerClient();
const fx = new Fixtures(db);
let app: NestExpressApplication;

let tenantId: string;
let owner: Browser;
let acme: string;
let hyd: string;
let blr: string;
let icu: string;

const today = localDate(new Date(), 'Asia/Kolkata');
/** The most recent Wednesday before today: a working day on the default Sunday-off shift. */
const wednesday = (() => {
  let d = addDays(today, -1);
  while (weekday(d) !== 3) d = addDays(d, -1);
  return d;
})();

interface Row {
  employee: { id: string };
}

interface Person {
  employeeId: string;
  browser: Browser;
  membershipId: string;
  email: string;
}

/** An employee with a sign-in, placed in a branch and department, optionally reporting to someone. */
async function person(
  label: string,
  placement: { branchId?: string; departmentId?: string; managerId?: string } = {},
  role?: { permissions: string[]; scope: { type: 'COMPANY' | 'BRANCH' | 'DEPARTMENT'; id: string } },
): Promise<Person> {
  const user = await fx.user(label);
  const m = await fx.member(tenantId, user.id);
  if (role)
    await fx.assign(tenantId, m.id, await fx.customRole(tenantId, label, role.permissions), role.scope);
  const res = await owner.send('post', '/v1/employees', {
    firstName: label,
    lastName: 'Test',
    companyId: acme,
    dateOfJoining: '2025-01-01',
    branchId: placement.branchId ?? hyd,
    ...(placement.departmentId ? { departmentId: placement.departmentId } : {}),
    ...(placement.managerId ? { managerId: placement.managerId } : {}),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await db.employee.update({ where: { id: res.body.id }, data: { membershipId: m.id } });
  const browser = new Browser(app);
  expect((await browser.login(user.email)).status).toBe(200);
  return { employeeId: res.body.id as string, browser, membershipId: m.id, email: user.email };
}

let manager: Person;
let nurse: Person;
let hrHyd: Person;

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  const tenant = await fx.tenant('Attendance');
  tenantId = tenant.id;
  const ownerUser = await fx.user('att-owner');
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  acme = (await fx.company(tenantId, 'ACME')).id;
  const branch = async (code: string) =>
    (
      await db.branch.create({
        data: { tenantId, companyId: acme, code: `${code}-${fx.run}`.toUpperCase(), name: code },
      })
    ).id;
  hyd = await branch('HYD');
  blr = await branch('BLR');
  icu = (
    await db.department.create({
      data: { tenantId, companyId: acme, code: `ICU-${fx.run}`.toUpperCase(), name: 'ICU' },
    })
  ).id;

  manager = await person('ward-manager', { departmentId: icu });
  nurse = await person('nurse', { departmentId: icu, managerId: manager.employeeId });
  hrHyd = await person(
    'hr-hyd',
    {},
    {
      permissions: ['attendance.view', 'attendance.manage'],
      scope: { type: 'BRANCH', id: hyd },
    },
  );
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await db.$disconnect();
});

describe('clocking in and out', () => {
  it('records one clock-in, refuses a second, then a clock-out, and shows the day', async () => {
    const before = (await nurse.browser.get('/v1/attendance/me/today')).body;
    expect(before).toMatchObject({ date: today, nextAction: 'IN', timeZone: 'Asia/Kolkata' });
    expect(before.shift).toMatchObject({ code: 'GENERAL', startMinute: 540 });

    expect(
      (await nurse.browser.send('post', '/v1/attendance/me/punch', { direction: 'OUT' })).body.code,
    ).toBe('NOT_CLOCKED_IN');
    const inRes = await nurse.browser.send('post', '/v1/attendance/me/punch', { direction: 'IN' });
    expect(inRes.status).toBe(200);
    expect(inRes.body).toMatchObject({ nextAction: 'OUT' });
    expect(inRes.body.result.openSince).not.toBeNull();
    expect((await nurse.browser.send('post', '/v1/attendance/me/punch', { direction: 'IN' })).body.code).toBe(
      'ALREADY_CLOCKED_IN',
    );
    const out = await nurse.browser.send('post', '/v1/attendance/me/punch', { direction: 'OUT' });
    expect(out.body).toMatchObject({ nextAction: 'IN' });
    expect((out.body.punches as { direction: string }[]).map((p) => p.direction)).toEqual(['IN', 'OUT']);

    const days = (await nurse.browser.get(`/v1/attendance/me/days?from=${today}&to=${today}`)).body.days;
    expect(days[0]).toMatchObject({ date: today, firstIn: expect.any(String), lastOut: expect.any(String) });
  });

  it('tells someone without an employee record what to do', async () => {
    const user = await fx.user('no-record');
    await fx.member(tenantId, user.id);
    const b = new Browser(app);
    await b.login(user.email);
    expect((await b.get('/v1/attendance/me/today')).body).toEqual({ employee: null });
    const res = await b.send('post', '/v1/attendance/me/punch', { direction: 'IN' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NO_EMPLOYEE_RECORD');
  });
});

describe('recording on someone’s behalf', () => {
  it('works out a past day, late arrival included, and is audited', async () => {
    const record = (time: string, direction: 'IN' | 'OUT') =>
      hrHyd.browser.send('post', '/v1/attendance/punches', {
        employeeId: nurse.employeeId,
        date: wednesday,
        time,
        direction,
        note: 'Biometric reader was down',
      });
    expect((await record('09:25', 'IN')).status).toBe(201);
    const res = await record('18:05', 'OUT');
    expect(res.status).toBe(201);
    expect(res.body.days[0]).toMatchObject({
      date: wednesday,
      status: 'PRESENT',
      lateMinutes: 25,
      workedMinutes: 520,
      earlyLeaveMinutes: 0,
    });
    expect(
      await db.auditEvent.count({
        where: { tenantId, action: 'attendance.punch.record', targetId: nurse.employeeId },
      }),
    ).toBe(2);
    expect(await db.attendancePunch.count({ where: { employeeId: nurse.employeeId, source: 'ADMIN' } })).toBe(
      2,
    );
  });

  it('needs attendance.manage where the employee sits, and never for oneself', async () => {
    const bangalore = await person('blr-staff', { branchId: blr });
    const outsider = await hrHyd.browser.send('post', '/v1/attendance/punches', {
      employeeId: bangalore.employeeId,
      date: wednesday,
      time: '09:00',
      direction: 'IN',
      note: 'Trying another branch',
    });
    expect(outsider.status).toBe(404);
    const self = await hrHyd.browser.send('post', '/v1/attendance/punches', {
      employeeId: hrHyd.employeeId,
      date: wednesday,
      time: '09:00',
      direction: 'IN',
      note: 'Recording myself',
    });
    expect(self.body.code).toBe('SEPARATION_OF_DUTIES');
    const future = await hrHyd.browser.send('post', '/v1/attendance/punches', {
      employeeId: nurse.employeeId,
      date: addDays(today, 1),
      time: '09:00',
      direction: 'IN',
      note: 'Tomorrow',
    });
    expect(future.status).toBe(400);
  });
});

describe('who sees whom', () => {
  it('shows a manager their reporting line, a scoped viewer their branch, and refuses everyone else', async () => {
    const managerTeam = (await manager.browser.get(`/v1/attendance/team?date=${wednesday}`)).body;
    expect((managerTeam.rows as Row[]).map((r) => r.employee.id)).toEqual([nurse.employeeId]);
    expect(managerTeam.rows[0].day).toMatchObject({ status: 'PRESENT', lateMinutes: 25 });
    expect(managerTeam.counts).toMatchObject({ total: 1, present: 1, late: 1 });

    const branchTeam = (await hrHyd.browser.get(`/v1/attendance/team?date=${wednesday}`)).body;
    const ids = (branchTeam.rows as Row[]).map((r) => r.employee.id);
    expect(ids).toContain(nurse.employeeId);
    expect(ids).toContain(manager.employeeId);
    // Nobody clocked in for the manager: a past working day reads as absent.
    const managerRow = (branchTeam.rows as (Row & { day: { status: string } })[]).find(
      (r: { employee: { id: string } }) => r.employee.id === manager.employeeId,
    );
    expect(managerRow?.day.status).toBe('ABSENT');

    expect((await nurse.browser.get(`/v1/attendance/team?date=${wednesday}`)).status).toBe(403);
    expect(
      (
        await nurse.browser.get(
          `/v1/attendance/employees/${manager.employeeId}/days?from=${wednesday}&to=${wednesday}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await manager.browser.get(
          `/v1/attendance/employees/${nurse.employeeId}/days?from=${wednesday}&to=${wednesday}`,
        )
      ).status,
    ).toBe(200);
  });

  it('builds a monthly register with totals', async () => {
    const month = wednesday.slice(0, 7);
    const res = await owner.get(`/v1/attendance/register?month=${month}`);
    expect(res.status).toBe(200);
    const row = (res.body.rows as (Row & { days: { date: string }[]; totals: { present: number } })[]).find(
      (r) => r.employee.id === nurse.employeeId,
    )!;
    const day = row.days.find((d) => d.date === wednesday);
    expect(day).toMatchObject({ status: 'PRESENT', late: true });
    expect(row.totals.present).toBeGreaterThanOrEqual(1);
    expect(res.body.dates[0]).toBe(`${month}-01`);
  });
});

describe('shifts', () => {
  it('lets only attendance.configure create shifts, with checked times and one default', async () => {
    const night = { code: 'NIGHT', name: 'Night', start: '22:00', end: '06:00', fullDayMinutes: 420 };
    expect((await hrHyd.browser.send('post', '/v1/attendance/shifts', night)).status).toBe(403);
    const bad = await owner.send('post', '/v1/attendance/shifts', {
      ...night,
      code: 'BAD',
      fullDayMinutes: 600,
    });
    expect(bad.status).toBe(400);
    const created = await owner.send('post', '/v1/attendance/shifts', night);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ start: '22:00', end: '06:00', isDefault: false });
    expect((await owner.send('post', '/v1/attendance/shifts', night)).body.code).toBe('CODE_TAKEN');

    const day = await owner.send('post', '/v1/attendance/shifts', {
      code: 'DAY',
      name: 'Day',
      start: '08:00',
      end: '17:00',
      isDefault: true,
    });
    const morning = await owner.send('post', '/v1/attendance/shifts', {
      code: 'MORNING',
      name: 'Morning',
      start: '06:00',
      end: '14:00',
      isDefault: true,
    });
    const list = (await owner.get('/v1/attendance/shifts')).body;
    expect(list.fallback).toBeNull();
    expect(
      (list.shifts as { isDefault: boolean; code: string }[]).filter((s) => s.isDefault).map((s) => s.code),
    ).toEqual(['MORNING']);
    // The default can't be archived; a shift in use can't be archived either.
    const archiveDefault = await owner.send('patch', `/v1/attendance/shifts/${morning.body.id}`, {
      name: 'Morning',
      start: '06:00',
      end: '14:00',
      status: 'ARCHIVED',
    });
    expect(archiveDefault.body.code).toBe('DEFAULT_SHIFT');
    expect(day.status).toBe(201);
  });

  it('assigns a shift from a date and recomputes days already worked out', async () => {
    const shifts = (await owner.get('/v1/attendance/shifts')).body.shifts as { id: string; code: string }[];
    const late = await owner.send('post', '/v1/attendance/shifts', {
      code: 'LATE',
      name: 'Late start',
      start: '10:00',
      end: '19:00',
    });
    expect(late.status).toBe(201);
    const res = await hrHyd.browser.send('post', '/v1/attendance/shift-assignments', {
      shiftId: late.body.id,
      effectiveFrom: wednesday,
      employeeIds: [nurse.employeeId],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.recomputedDays).toBeGreaterThanOrEqual(1);
    const days = (
      await owner.get(`/v1/attendance/employees/${nurse.employeeId}/days?from=${wednesday}&to=${wednesday}`)
    ).body.days;
    // 09:25 is early for a 10:00 start: no longer late.
    expect(days[0]).toMatchObject({ lateMinutes: 0, shift: { code: 'LATE' } });
    const history = (await owner.get(`/v1/attendance/employees/${nurse.employeeId}/shifts`)).body;
    expect(history[0]).toMatchObject({ effectiveFrom: wednesday, shift: { code: 'LATE' } });

    const inUse = await owner.send('patch', `/v1/attendance/shifts/${late.body.id}`, {
      name: 'Late start',
      start: '10:00',
      end: '19:00',
      status: 'ARCHIVED',
    });
    expect(inUse.body.code).toBe('SHIFT_IN_USE');
    expect(shifts.length).toBeGreaterThan(0);
  });
});

describe('corrections', () => {
  const correctionDay = () => addDays(wednesday, -1);

  it('go to the reporting manager, and once approved become clock-ins on that day', async () => {
    const date = correctionDay();
    const res = await nurse.browser.send('post', '/v1/attendance/corrections', {
      date,
      in: '10:00',
      out: '19:00',
      reason: 'Forgot to clock in and out',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ status: 'PENDING', date });

    // A second open correction for the same day is refused.
    const again = await nurse.browser.send('post', '/v1/attendance/corrections', {
      date,
      out: '19:00',
      reason: 'Again',
    });
    expect(again.body.code).toBe('CORRECTION_OPEN');

    const inbox = (await manager.browser.get('/v1/approvals/inbox')).body as {
      id: string;
      request: { id: string };
    }[];
    const task = inbox.find((t) => t.request.id === res.body.approvalRequest.id);
    expect(task, 'the manager is the approver').toBeDefined();
    const request = await db.approvalRequest.findUniqueOrThrow({
      where: { id: res.body.approvalRequest.id },
    });
    expect(request.subjectEmployeeId).toBe(nurse.employeeId);

    // The approver can open the correction even though they hold no attendance permission.
    expect((await manager.browser.get(`/v1/attendance/corrections/${res.body.id}`)).status).toBe(200);

    const decided = await manager.browser.send('post', `/v1/approvals/tasks/${task!.id}/decision`, {
      decision: 'APPROVE',
    });
    expect(decided.status).toBe(200);
    const after = (await nurse.browser.get(`/v1/attendance/corrections/${res.body.id}`)).body;
    expect(after.status).toBe('APPROVED');
    const day = (await nurse.browser.get(`/v1/attendance/me/days?from=${date}&to=${date}`)).body.days[0];
    // The day before the late-start assignment is on the organisation's default shift, which starts at 06:00.
    expect(day).toMatchObject({
      corrected: true,
      workedMinutes: 540,
      lateMinutes: 240,
      shift: { code: 'MORNING' },
    });
    expect(
      await db.attendancePunch.count({ where: { correctionId: res.body.id, source: 'CORRECTION' } }),
    ).toBe(2);
  });

  it('can be withdrawn, and are refused for the future or too long ago', async () => {
    const date = addDays(wednesday, -2);
    const res = await nurse.browser.send('post', '/v1/attendance/corrections', {
      date,
      out: '18:00',
      reason: 'Left without clocking out',
    });
    expect(res.status).toBe(201);
    const cancelled = await nurse.browser.send(
      'post',
      `/v1/attendance/corrections/${res.body.id}/cancel`,
      {},
    );
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(
      ((await manager.browser.get('/v1/approvals/inbox')).body as { request: { id: string } }[]).some(
        (t: { request: { id: string } }) => t.request.id === res.body.approvalRequest.id,
      ),
    ).toBe(false);
    // The database refuses to reopen a finished correction.
    await expect(
      db.attendanceCorrection.update({ where: { id: res.body.id }, data: { status: 'PENDING' } }),
    ).rejects.toThrow();

    const future = await nurse.browser.send('post', '/v1/attendance/corrections', {
      date: addDays(today, 1),
      in: '09:00',
      reason: 'Future',
    });
    expect(future.status).toBe(400);
    const ancient = await nurse.browser.send('post', '/v1/attendance/corrections', {
      date: addDays(today, -90),
      in: '09:00',
      reason: 'Long ago',
    });
    expect(ancient.status).toBe(400);
  });

  it('fall back to the owners when the employee has no manager who can sign in', async () => {
    const loner = await person('no-manager');
    const res = await loner.browser.send('post', '/v1/attendance/corrections', {
      date: wednesday,
      in: '09:00',
      out: '18:00',
      reason: 'Device failure',
    });
    expect(res.status).toBe(201);
    const ownerInbox = (await owner.get('/v1/approvals/inbox')).body as { request: { id: string } }[];
    expect(ownerInbox.some((t) => t.request.id === res.body.approvalRequest.id)).toBe(true);
  });

  it('lists mine and my team’s', async () => {
    const mine = (await nurse.browser.get('/v1/attendance/corrections?scope=mine')).body;
    expect(mine.length).toBeGreaterThanOrEqual(2);
    const team = (await manager.browser.get('/v1/attendance/corrections?scope=team')).body;
    expect((team as Row[]).every((c) => c.employee.id === nurse.employeeId)).toBe(true);
  });
});

describe('plan', () => {
  it('refuses attendance when the plan doesn’t include it', async () => {
    await db.entitlementOverride.create({
      data: { tenantId, kind: 'FEATURE', key: 'attendance.basic', enabled: false, reason: 'test' },
    });
    try {
      const res = await nurse.browser.get('/v1/attendance/me/today');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ENTITLEMENT_REQUIRED');
    } finally {
      await db.entitlementOverride.deleteMany({ where: { tenantId, key: 'attendance.basic' } });
    }
  });
});
