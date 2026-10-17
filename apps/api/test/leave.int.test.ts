/**
 * Holidays and leave through the real API and database: calendars per place and who may change them,
 * holidays in attendance, automatic and idempotent credits (yearly, monthly, carry-forward), requests through
 * the approval engine with the reporting manager as approver, balance and overlap rules, cancellation with
 * reversal, working on someone's behalf, adjustments, visibility and the plan gate.
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
let hyd: string;
let blr: string;

const today = localDate(new Date(), 'Asia/Kolkata');
const year = Number(today.slice(0, 4));
/** The next date on or after `from` that falls on a weekday (0 = Sunday). */
const nextWeekday = (from: string, day: number) => {
  let d = from;
  while (weekday(d) !== day) d = addDays(d, 1);
  return d;
};
/** A Monday at least two weeks ahead, so notice rules and "future" both hold. */
const monday = nextWeekday(addDays(today, 14), 1);
/** The most recent Wednesday before today. */
const pastWednesday = (() => {
  let d = addDays(today, -1);
  while (weekday(d) !== 3) d = addDays(d, -1);
  return d;
})();

interface Person {
  employeeId: string;
  browser: Browser;
  membershipId: string;
}

async function person(
  label: string,
  placement: { branchId?: string; managerId?: string } = {},
  role?: { permissions: string[]; scope: { type: 'TENANT' | 'COMPANY' | 'BRANCH'; id: string } },
): Promise<Person> {
  const user = await fx.user(label);
  const m = await fx.member(tenantId, user.id);
  if (role)
    await fx.assign(tenantId, m.id, await fx.customRole(tenantId, label, role.permissions), role.scope);
  const res = await owner.send('post', '/v1/employees', {
    firstName: label,
    lastName: 'Test',
    companyId: acme,
    dateOfJoining: `${year - 1}-01-01`,
    branchId: placement.branchId ?? hyd,
    ...(placement.managerId ? { managerId: placement.managerId } : {}),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await db.employee.update({ where: { id: res.body.id }, data: { membershipId: m.id } });
  const browser = new Browser(app);
  expect((await browser.login(user.email)).status).toBe(200);
  return { employeeId: res.body.id as string, browser, membershipId: m.id };
}

interface Balance {
  leaveType: { id: string; code: string };
  credited: number;
  carriedForward: number;
  adjusted: number;
  taken: number;
  lapsed: number;
  balance: number;
  pending: number;
  available: number;
}

async function balanceOf(p: Person, typeId: string, y = year): Promise<Balance> {
  const res = await p.browser.get(`/v1/leave/me/balances?year=${y}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.balances as Balance[]).find((b) => b.leaveType.id === typeId)!;
}

async function approveAs(approver: Person, approvalRequestId: string) {
  const inbox = (await approver.browser.get('/v1/approvals/inbox')).body as {
    id: string;
    request: { id: string };
  }[];
  const task = inbox.find((t) => t.request.id === approvalRequestId);
  expect(task, 'the approver has the task').toBeDefined();
  const res = await approver.browser.send('post', `/v1/approvals/tasks/${task!.id}/decision`, {
    decision: 'APPROVE',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

let manager: Person;
let nurse: Person;
let other: Person;
let hrHyd: Person;
let annual: string;
let monthly: string;
let unpaid: string;

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  const tenant = await fx.tenant('Leave');
  tenantId = tenant.id;
  const ownerUser = await fx.user('leave-owner');
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

  manager = await person('leave-manager');
  nurse = await person('leave-nurse', { managerId: manager.employeeId });
  other = await person('leave-other', { branchId: blr });
  hrHyd = await person(
    'leave-hr',
    {},
    { permissions: ['leave.view', 'leave.manage', 'leave.configure'], scope: { type: 'BRANCH', id: hyd } },
  );

  const type = async (body: Record<string, unknown>) => {
    const res = await owner.send('post', '/v1/leave/types', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };
  annual = await type({
    code: 'EL',
    name: 'Earned leave',
    accrual: 'YEARLY',
    quotaDays: 12,
    carryForwardMaxDays: 5,
  });
  monthly = await type({
    code: 'CL',
    name: 'Casual leave',
    accrual: 'MONTHLY',
    quotaDays: 12,
    allowHalfDay: true,
  });
  unpaid = await type({ code: 'LWP', name: 'Leave without pay', accrual: 'NONE', paid: false, quotaDays: 0 });
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await runtime.$disconnect();
  await db.$disconnect();
});

describe('leave types', () => {
  it('are set up by leave.configure for the whole organisation, with checked rules', async () => {
    expect((await nurse.browser.get('/v1/leave/types')).body).toHaveLength(3);
    // Branch-scoped configure isn't enough for organisation-wide types.
    expect(
      (await hrHyd.browser.send('post', '/v1/leave/types', { code: 'SL', name: 'Sick', quotaDays: 6 }))
        .status,
    ).toBe(403);
    const bad = await owner.send('post', '/v1/leave/types', {
      code: 'X1',
      name: 'Odd',
      accrual: 'NONE',
      quotaDays: 3,
    });
    expect(bad.status).toBe(400);
    const half = await owner.send('post', '/v1/leave/types', { code: 'X2', name: 'Odd', quotaDays: 2.25 });
    expect(half.status).toBe(400);
    const taken = await owner.send('post', '/v1/leave/types', { code: 'EL', name: 'Again', quotaDays: 3 });
    expect(taken.body.code).toBe('CODE_TAKEN');
  });
});

describe('balances', () => {
  it('credits the yearly grant, monthly accruals and last year’s carry-forward, once', async () => {
    const [el, cl] = await Promise.all([balanceOf(nurse, annual), balanceOf(nurse, monthly)]);
    // Joined last January: last year's 12 days are unused, so 5 carry forward and 7 lapse.
    expect(el).toMatchObject({ credited: 12, carriedForward: 5, balance: 17, available: 17 });
    expect(cl.credited).toBe(Number(today.slice(5, 7)));
    // Asking again, even all at once, credits nothing more.
    await Promise.all([1, 2, 3].map(() => nurse.browser.get(`/v1/leave/me/balances?year=${year}`)));
    expect(await balanceOf(nurse, annual)).toMatchObject({ credited: 12, carriedForward: 5, balance: 17 });
    const lapse = await db.leaveLedgerEntry.findMany({
      where: { employeeId: nurse.employeeId, leaveTypeId: annual, kind: 'LAPSE' },
    });
    expect(lapse.map((l) => [l.year, Number(l.days)])).toEqual([[year - 1, -7]]);
    // Types without a balance aren't listed.
    expect((await nurse.browser.get(`/v1/leave/me/balances?year=${year}`)).body.balances).toHaveLength(2);
  });
});

describe('holidays', () => {
  let orgCalendar: string;
  let hydCalendar: string;

  it('one calendar per place; branch HR may change their branch’s but not the organisation’s', async () => {
    const org = await owner.send('post', '/v1/holidays/calendars', {
      name: 'India',
      place: { type: 'TENANT' },
    });
    expect(org.status, JSON.stringify(org.body)).toBe(201);
    orgCalendar = org.body.id;
    expect(
      (await owner.send('post', '/v1/holidays/calendars', { name: 'Again', place: { type: 'TENANT' } })).body
        .code,
    ).toBe('CALENDAR_EXISTS');

    const branchCal = await hrHyd.browser.send('post', '/v1/holidays/calendars', {
      name: 'Telangana',
      place: { type: 'BRANCH', id: hyd },
    });
    expect(branchCal.status, JSON.stringify(branchCal.body)).toBe(201);
    hydCalendar = branchCal.body.id;
    expect(
      (
        await hrHyd.browser.send('post', `/v1/holidays/calendars/${orgCalendar}/holidays`, {
          date: monday,
          name: 'Branch HR day',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await hrHyd.browser.send('post', '/v1/holidays/calendars', {
          name: 'BLR',
          place: { type: 'BRANCH', id: blr },
        })
      ).status,
    ).toBe(403);
    // A mismatched scope key is refused by the database itself.
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.holidayCalendar.create({ data: { tenantId, name: 'Bad', scopeKey: 'TENANT', branchId: blr } }),
      ),
    ).rejects.toThrow(/scope key/);
  });

  it('applies the most specific calendar, and changes attendance already worked out', async () => {
    const tuesday = addDays(monday, 1);
    expect(
      (
        await owner.send('post', `/v1/holidays/calendars/${orgCalendar}/holidays`, {
          date: tuesday,
          name: 'Org day',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await hrHyd.browser.send('post', `/v1/holidays/calendars/${hydCalendar}/holidays`, {
          date: monday,
          name: 'Bonalu',
        })
      ).status,
    ).toBe(201);
    // Hyderabad follows its branch calendar only; Bengaluru the organisation's.
    const mineHyd = (await nurse.browser.get(`/v1/holidays/mine?year=${year}`)).body;
    expect(mineHyd.calendar.name).toBe('Telangana');
    expect((mineHyd.holidays as { name: string }[]).map((h) => h.name)).toEqual(['Bonalu']);
    const mineBlr = (await other.browser.get(`/v1/holidays/mine?year=${year}`)).body;
    expect((mineBlr.holidays as { name: string }[]).map((h) => h.name)).toEqual(['Org day']);
    const days = (await nurse.browser.get(`/v1/attendance/me/days?from=${monday}&to=${tuesday}`)).body.days;
    expect(
      (days as { status: string | null; holiday: string | null }[]).map((d) => [d.status, d.holiday]),
    ).toEqual([
      ['HOLIDAY', 'Bonalu'],
      [null, null],
    ]);

    // A past day already worked out as absent becomes a holiday when one is added.
    for (const [time, direction] of [
      ['09:00', 'IN'],
      ['10:00', 'OUT'],
    ] as const) {
      const punch = await owner.send('post', '/v1/attendance/punches', {
        employeeId: nurse.employeeId,
        date: pastWednesday,
        time,
        direction,
        note: 'Reader was down',
      });
      expect(punch.status, JSON.stringify(punch.body)).toBe(201);
    }
    const before = await db.attendanceDay.findFirstOrThrow({
      where: { employeeId: nurse.employeeId, date: new Date(`${pastWednesday}T00:00:00Z`) },
    });
    expect(before.status).toBe('ABSENT');
    const added = await hrHyd.browser.send('post', `/v1/holidays/calendars/${hydCalendar}/holidays`, {
      date: pastWednesday,
      name: 'Past holiday',
    });
    expect(added.status).toBe(201);
    const after = await db.attendanceDay.findFirstOrThrow({ where: { id: before.id } });
    expect(after).toMatchObject({ status: 'HOLIDAY', overtimeMinutes: 60 });
    // Removing it puts the day back.
    expect((await hrHyd.browser.send('delete', `/v1/holidays/${added.body.id}`)).status).toBe(204);
    expect((await db.attendanceDay.findFirstOrThrow({ where: { id: before.id } })).status).toBe('ABSENT');
  });
});

describe('requests', () => {
  let approvedId: string;

  it('count working days only, go to the manager, and come off the balance when approved', async () => {
    // Monday is a Hyderabad holiday and Sunday is a weekly off: Sat–Tue uses Sat and Tue only.
    const saturday = addDays(monday, -2);
    const tuesday = addDays(monday, 1);
    const preview = await nurse.browser.send('post', '/v1/leave/preview', {
      leaveTypeId: annual,
      from: saturday,
      to: tuesday,
    });
    expect(preview.body).toMatchObject({ days: 2, available: 17, afterwards: 15 });

    const res = await nurse.browser.send('post', '/v1/leave/requests', {
      leaveTypeId: annual,
      from: saturday,
      to: tuesday,
      reason: 'Family wedding',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ status: 'PENDING', days: 2, canCancel: true });
    approvedId = res.body.id;
    expect(await balanceOf(nurse, annual)).toMatchObject({ balance: 17, pending: 2, available: 15 });

    // Overlapping leave is refused while the first is open.
    const overlap = await nurse.browser.send('post', '/v1/leave/requests', {
      leaveTypeId: monthly,
      from: tuesday,
      to: tuesday,
      reason: 'Again',
    });
    expect(overlap.body.code).toBe('LEAVE_OVERLAP');

    // The manager can see it in their team, and approves it.
    const team = (await manager.browser.get('/v1/leave/requests?scope=team')).body as { id: string }[];
    expect(team.map((r) => r.id)).toContain(res.body.id);
    expect((await manager.browser.get(`/v1/leave/requests/${res.body.id}`)).status).toBe(200);
    await approveAs(manager, (res.body as { approvalRequest: { id: string } }).approvalRequest.id);

    expect((await nurse.browser.get(`/v1/leave/requests/${res.body.id}`)).body.status).toBe('APPROVED');
    expect(await balanceOf(nurse, annual)).toMatchObject({
      taken: 2,
      balance: 15,
      pending: 0,
      available: 15,
    });
    const days = (await nurse.browser.get(`/v1/attendance/me/days?from=${saturday}&to=${tuesday}`)).body.days;
    // Leave covers the working days; the weekly off and the holiday stay what they are.
    expect((days as { status: string | null }[]).map((d) => d.status)).toEqual([
      'ON_LEAVE',
      'WEEKLY_OFF',
      'HOLIDAY',
      'ON_LEAVE',
    ]);
  });

  it('enforce balance, half-day, notice, all-non-working and back-dating rules', async () => {
    const wednesday = addDays(monday, 2);
    const tooMuch = await nurse.browser.send('post', '/v1/leave/requests', {
      leaveTypeId: monthly,
      from: wednesday,
      to: addDays(wednesday, 40),
      reason: 'Long trip',
    });
    expect(tooMuch.body.code).toBe('INSUFFICIENT_BALANCE');

    const noHalf = await owner.send('patch', `/v1/leave/types/${annual}`, {
      name: 'Earned leave',
      accrual: 'YEARLY',
      quotaDays: 12,
      carryForwardMaxDays: 5,
      allowHalfDay: false,
      minNoticeDays: 30,
    });
    expect(noHalf.status, JSON.stringify(noHalf.body)).toBe(200);
    const half = await nurse.browser.send('post', '/v1/leave/requests', {
      leaveTypeId: annual,
      from: wednesday,
      to: wednesday,
      halfDay: 'FIRST_HALF',
      reason: 'Errand',
    });
    expect(half.body.errors?.[0]?.path).toBe('halfDay');
    const notice = await nurse.browser.send('post', '/v1/leave/requests', {
      leaveTypeId: annual,
      from: wednesday,
      to: wednesday,
      reason: 'Errand',
    });
    expect(notice.body.detail).toMatch(/30 days’ notice/);
    // Someone with leave.manage applying on the nurse's behalf isn't bound by notice.
    const onBehalf = await hrHyd.browser.send('post', '/v1/leave/requests', {
      employeeId: nurse.employeeId,
      leaveTypeId: annual,
      from: wednesday,
      to: wednesday,
      reason: 'Recorded by HR',
    });
    expect(onBehalf.status, JSON.stringify(onBehalf.body)).toBe(201);
    await owner.send('patch', `/v1/leave/types/${annual}`, {
      name: 'Earned leave',
      accrual: 'YEARLY',
      quotaDays: 12,
      carryForwardMaxDays: 5,
      allowHalfDay: true,
      minNoticeDays: 0,
    });

    const sunday = addDays(monday, -1);
    const allOff = await nurse.browser.send('post', '/v1/leave/requests', {
      leaveTypeId: monthly,
      from: sunday,
      to: monday,
      reason: 'Weekend',
    });
    expect(allOff.body.detail).toMatch(/weekly offs or holidays/);

    const longAgo = await nurse.browser.send('post', '/v1/leave/requests', {
      leaveTypeId: monthly,
      from: addDays(today, -90),
      to: addDays(today, -90),
      reason: 'Old',
    });
    expect(longAgo.body.errors?.[0]?.path).toBe('from');

    // Unpaid leave keeps no balance, so it is never short.
    const lwp = await nurse.browser.send('post', '/v1/leave/requests', {
      leaveTypeId: unpaid,
      from: addDays(monday, 7),
      to: addDays(monday, 11),
      reason: 'Personal',
    });
    expect(lwp.status, JSON.stringify(lwp.body)).toBe(201);
  });

  it('half days make a half-day status, and the ledger and requests are guarded by the database', async () => {
    const thursday = addDays(monday, 3);
    const res = await nurse.browser.send('post', '/v1/leave/requests', {
      leaveTypeId: monthly,
      from: thursday,
      to: thursday,
      halfDay: 'SECOND_HALF',
      reason: 'Doctor',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.days).toBe(0.5);

    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.leaveLedgerEntry.updateMany({ where: { employeeId: nurse.employeeId }, data: { days: 99 } }),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.leaveLedgerEntry.deleteMany({ where: { employeeId: nurse.employeeId } }),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.leaveLedgerEntry.create({
          data: {
            tenantId,
            employeeId: nurse.employeeId,
            leaveTypeId: annual,
            year,
            kind: 'GRANT',
            days: -3,
          },
        }),
      ),
    ).rejects.toThrow(/grant can't be/);
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.leaveRequest.update({ where: { id: approvedId }, data: { status: 'PENDING' } }),
      ),
    ).rejects.toThrow(/can only be cancelled/);
  });

  it('cancelling approved leave returns the days; once started only HR can', async () => {
    const res = await nurse.browser.send('post', `/v1/leave/requests/${approvedId}/cancel`, {
      reason: 'Plans changed',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
    expect((await balanceOf(nurse, annual)).taken).toBe(0);

    // Leave that has started: recorded by HR for a past day, approved, then the nurse tries to cancel.
    const past = await hrHyd.browser.send('post', '/v1/leave/requests', {
      employeeId: nurse.employeeId,
      leaveTypeId: monthly,
      from: pastWednesday,
      to: pastWednesday,
      reason: 'Was unwell',
    });
    expect(past.status, JSON.stringify(past.body)).toBe(201);
    await approveAs(manager, (past.body as { approvalRequest: { id: string } }).approvalRequest.id);
    const day = (await nurse.browser.get(`/v1/attendance/me/days?from=${pastWednesday}&to=${pastWednesday}`))
      .body.days[0];
    expect(day.status).toBe('ON_LEAVE');
    expect(
      (await nurse.browser.send('post', `/v1/leave/requests/${past.body.id}/cancel`, {})).body.code,
    ).toBe('LEAVE_STARTED');
    const byHr = await hrHyd.browser.send('post', `/v1/leave/requests/${past.body.id}/cancel`, {
      reason: 'Came in',
    });
    expect(byHr.body.status).toBe('CANCELLED');
    expect(
      (await nurse.browser.get(`/v1/attendance/me/days?from=${pastWednesday}&to=${pastWednesday}`)).body
        .days[0].status,
    ).not.toBe('ON_LEAVE');
    expect(await db.leaveLedgerEntry.count({ where: { requestId: past.body.id, kind: 'REVERSAL' } })).toBe(1);
  });

  it('withdraws an open request through the approval engine', async () => {
    const friday = addDays(monday, 18);
    const res = await nurse.browser.send('post', '/v1/leave/requests', {
      leaveTypeId: monthly,
      from: friday,
      to: friday,
      reason: 'Maybe',
    });
    const withdrawn = await nurse.browser.send('post', `/v1/leave/requests/${res.body.id}/cancel`, {});
    expect(withdrawn.body.status).toBe('CANCELLED');
    expect(
      (await db.approvalRequest.findUniqueOrThrow({ where: { id: res.body.approvalRequest.id } })).status,
    ).toBe('CANCELLED');
  });
});

describe('on someone’s behalf', () => {
  it('needs leave.manage where the employee sits, and never one’s own balance', async () => {
    expect(
      (
        await hrHyd.browser.send('post', '/v1/leave/requests', {
          employeeId: other.employeeId,
          leaveTypeId: monthly,
          from: addDays(monday, 21),
          to: addDays(monday, 21),
          reason: 'Outside my branch',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await manager.browser.send('post', '/v1/leave/adjustments', {
          employeeId: nurse.employeeId,
          leaveTypeId: annual,
          year,
          days: 2,
          note: 'Comp off',
        })
      ).status,
    ).toBe(403);
    const own = await hrHyd.browser.send('post', '/v1/leave/adjustments', {
      employeeId: hrHyd.employeeId,
      leaveTypeId: annual,
      year,
      days: 5,
      note: 'Bonus',
    });
    expect(own.body.code).toBe('SEPARATION_OF_DUTIES');
    const adj = await hrHyd.browser.send('post', '/v1/leave/adjustments', {
      employeeId: nurse.employeeId,
      leaveTypeId: annual,
      year,
      days: 1.5,
      note: 'Worked on a holiday',
    });
    expect(adj.status, JSON.stringify(adj.body)).toBe(201);
    expect((await balanceOf(nurse, annual)).adjusted).toBe(1.5);
    expect(
      await db.auditEvent.count({
        where: { tenantId, action: 'leave.balance.adjust', targetId: nurse.employeeId },
      }),
    ).toBe(1);
  });

  it('shows balances only for the people in scope', async () => {
    const hr = (await hrHyd.browser.get(`/v1/leave/balances?year=${year}`)).body as {
      rows: { employee: { id: string } }[];
    };
    const ids = hr.rows.map((r) => r.employee.id);
    expect(ids).toContain(nurse.employeeId);
    expect(ids).not.toContain(other.employeeId);
    expect(
      (await other.browser.get(`/v1/leave/employees/${nurse.employeeId}/balances?year=${year}`)).status,
    ).toBe(404);
    const detail = await manager.browser.get(`/v1/leave/employees/${nurse.employeeId}/balances?year=${year}`);
    expect(detail.status).toBe(200);
    expect(detail.body.canAdjust).toBe(false);
  });

  it('brings everyone’s balances up to date in one go, and repeating it adds nothing', async () => {
    expect((await hrHyd.browser.send('post', '/v1/leave/allocations', { year })).status).toBe(403);
    const first = await owner.send('post', '/v1/leave/allocations', { year });
    expect(first.status).toBe(200);
    const again = await owner.send('post', '/v1/leave/allocations', { year });
    expect(again.body.entries).toBe(0);
  });
});

describe('plan', () => {
  it('gates leave by its feature, while holidays need attendance or leave', async () => {
    await db.entitlementOverride.create({
      data: { tenantId, kind: 'FEATURE', key: 'leave.basic', enabled: false, reason: 'test' },
    });
    try {
      expect((await nurse.browser.get('/v1/leave/types')).body.code).toBe('ENTITLEMENT_REQUIRED');
      expect((await nurse.browser.get(`/v1/holidays/mine?year=${year}`)).status).toBe(200);
      await db.entitlementOverride.create({
        data: { tenantId, kind: 'FEATURE', key: 'attendance.basic', enabled: false, reason: 'test' },
      });
      expect((await nurse.browser.get(`/v1/holidays/mine?year=${year}`)).body.code).toBe(
        'ENTITLEMENT_REQUIRED',
      );
    } finally {
      await db.entitlementOverride.deleteMany({
        where: { tenantId, key: { in: ['leave.basic', 'attendance.basic'] } },
      });
    }
  });
});
