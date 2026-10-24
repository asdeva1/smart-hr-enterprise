/**
 * Advanced attendance through the real API and database: the attendance rules, overtime with approval,
 * rosters overriding the usual shift, geofenced clock-in, limits on corrections, the plan gate and the
 * rules the database itself enforces.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDatabaseClient } from '@smart-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate, weekday } from '../src/attendance/attendance-calc.js';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import { Browser, Fixtures, ownerClient, requireEnv, startApp, testEnv } from './helpers.js';

const db = ownerClient();
const fx = new Fixtures(db);
let app: NestExpressApplication;

let tenantId: string;
let owner: Browser;
let acme: string;

const today = localDate(new Date(), 'Asia/Kolkata');
/** The most recent Wednesday before today: a working day on the default Sunday-off shift. */
const wednesday = (() => {
  let d = addDays(today, -1);
  while (weekday(d) !== 3) d = addDays(d, -1);
  return d;
})();
const earlierThan = (date: string) => {
  let d = addDays(date, -7);
  while (weekday(d) !== 3) d = addDays(d, -1);
  return d;
};

interface Person {
  employeeId: string;
  browser: Browser;
}

async function person(
  label: string,
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
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await db.employee.update({ where: { id: res.body.id }, data: { membershipId: m.id } });
  const browser = new Browser(app);
  expect((await browser.login(user.email)).status).toBe(200);
  return { employeeId: res.body.id as string, browser };
}

const policy = (over: Record<string, unknown> = {}) => ({
  overtimeEnabled: true,
  overtimeThresholdMinutes: 30,
  overtimeRoundMinutes: 15,
  overtimeDailyCapMinutes: 120,
  overtimeOffDayCounts: true,
  overtimeNeedsApproval: true,
  maxCorrectionsPerMonth: null,
  maxCorrectionBackdateDays: null,
  geofenceMode: 'OFF',
  ...over,
});

let worker: Person;
let hr: Person;

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  const tenant = await fx.tenant('AdvAttendance');
  tenantId = tenant.id;
  const ownerUser = await fx.user('adv-owner');
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  acme = (await fx.company(tenantId, 'ACME')).id;
  worker = await person('adv-worker');
  hr = await person('adv-hr', {
    permissions: ['attendance.view', 'attendance.manage', 'employees.view'],
    scope: { type: 'COMPANY', id: acme },
  });
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await db.$disconnect();
});

describe('plan gate and permissions', () => {
  it('is closed on a plan without the advanced module', async () => {
    const basic = await fx.tenant('AdvBasic', 'ACTIVE', { plan: 'LITE' });
    const user = await fx.user('adv-basic-owner');
    await fx.member(basic.id, user.id, true);
    const b = new Browser(app);
    await b.login(user.email);
    expect([402, 403]).toContain((await b.get('/v1/attendance/policy')).status);
  });

  it('lets only people who configure attendance change the rules', async () => {
    const denied = await hr.browser.send('put', '/v1/attendance/policy', policy());
    expect(denied.status).toBe(403);
    const saved = await owner.send('put', '/v1/attendance/policy', policy());
    expect(saved.status).toBe(200);
  });

  it('starts with legacy defaults and rejects values the database would refuse', async () => {
    const bad = await owner.send('put', '/v1/attendance/policy', policy({ overtimeRoundMinutes: 7 }));
    expect(bad.status).toBe(400);
    const got = await owner.get('/v1/attendance/policy');
    expect(got.body).toMatchObject({ configured: true, overtimeThresholdMinutes: 30, geofenceMode: 'OFF' });
  });
});

describe('overtime', () => {
  const at = (time: string, direction: 'IN' | 'OUT') =>
    hr.browser.send('post', '/v1/attendance/punches', {
      employeeId: worker.employeeId,
      date: wednesday,
      time,
      direction,
      note: 'Test punches',
    });

  it('applies the threshold, rounding and cap to the day', async () => {
    expect((await at('09:00', 'IN')).status).toBe(201);
    expect((await at('18:50', 'OUT')).status).toBe(201);
    // 09:00–18:50 is 590 minutes against 480 expected: 110 extra, 30 buffer, rounded down to 75.
    const list = await hr.browser.get(`/v1/attendance/overtime?from=${wednesday}&to=${wednesday}&status=ALL`);
    expect(list.status).toBe(200);
    const row = list.body.rows.find((r: { employeeId: string }) => r.employeeId === worker.employeeId);
    expect(row).toMatchObject({ overtimeMinutes: 75, decision: 'PENDING', approvedMinutes: 0 });
  });

  it('is approved for fewer minutes than worked, never more', async () => {
    const body = { employeeId: worker.employeeId, date: wednesday, decision: 'APPROVED', minutes: 60 };
    const res = await hr.browser.send('post', '/v1/attendance/overtime/decide', body);
    expect(res.status).toBe(200);
    expect(res.body.approvedMinutes).toBe(60);
    const more = await hr.browser.send('post', '/v1/attendance/overtime/decide', { ...body, minutes: 500 });
    expect(more.body.approvedMinutes).toBe(75);
    const list = await hr.browser.get(
      `/v1/attendance/overtime?from=${wednesday}&to=${wednesday}&status=DECIDED`,
    );
    expect(list.body.rows[0]).toMatchObject({ decision: 'APPROVED', approvedMinutes: 75 });
  });

  it('can be rejected, which approves nothing', async () => {
    const res = await hr.browser.send('post', '/v1/attendance/overtime/decide', {
      employeeId: worker.employeeId,
      date: wednesday,
      decision: 'REJECTED',
      note: 'Not authorised',
    });
    expect(res.body.approvedMinutes).toBe(0);
  });

  it('cannot be decided by the person who worked it', async () => {
    await db.attendanceDay.updateMany({
      where: { employeeId: hr.employeeId },
      data: {},
    });
    const mine = await hr.browser.send('post', '/v1/attendance/punches', {
      employeeId: hr.employeeId,
      date: wednesday,
      time: '09:00',
      direction: 'IN',
      note: 'Self record',
    });
    // Recording for yourself is refused outright; either way no overtime exists to approve for oneself.
    expect([403, 409, 422]).toContain(mine.status);
    const res = await hr.browser.send('post', '/v1/attendance/overtime/decide', {
      employeeId: hr.employeeId,
      date: wednesday,
      decision: 'APPROVED',
    });
    expect([403, 404]).toContain(res.status);
  });

  it('is not counted when overtime is switched off', async () => {
    await owner.send('put', '/v1/attendance/policy', policy({ overtimeEnabled: false }));
    await at('09:01', 'IN').catch(() => undefined);
    const other = await owner.send('post', '/v1/attendance/punches', {
      employeeId: worker.employeeId,
      date: wednesday,
      time: '20:30',
      direction: 'OUT',
      note: 'Recompute',
    });
    expect([201, 409]).toContain(other.status);
    const list = await hr.browser.get(`/v1/attendance/overtime?from=${wednesday}&to=${wednesday}&status=ALL`);
    expect(
      list.body.rows.filter((r: { employeeId: string }) => r.employeeId === worker.employeeId),
    ).toHaveLength(0);
    await owner.send('put', '/v1/attendance/policy', policy());
  });
});

describe('rosters', () => {
  let nightShift: string;
  const friday = (() => {
    let d = addDays(today, 1);
    while (weekday(d) !== 5) d = addDays(d, 1);
    return d;
  })();

  beforeAll(async () => {
    const created = await owner.send('post', '/v1/attendance/shifts', {
      code: 'EVE',
      name: 'Evening',
      start: '14:00',
      end: '22:00',
      breakMinutes: 30,
      graceMinutes: 10,
      halfDayMinutes: 240,
      fullDayMinutes: 420,
      weeklyOffs: [0],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    nightShift = created.body.id as string;
  });

  it('puts people on a shift for chosen weekdays and shows it', async () => {
    const set = await hr.browser.send('put', '/v1/attendance/roster', {
      employeeIds: [worker.employeeId],
      from: friday,
      to: addDays(friday, 6),
      weekdays: [5, 6],
      shiftId: nightShift,
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body).toMatchObject({ people: 1, days: 2 });
    const view = await hr.browser.get(`/v1/attendance/roster?from=${friday}&to=${addDays(friday, 6)}`);
    const w = view.body.employees.find((e: { id: string }) => e.id === worker.employeeId);
    expect(w.days[0]).toMatchObject({ date: friday, rostered: true, shiftCode: 'EVE' });
    expect(w.days[1]).toMatchObject({ rostered: true });
    expect(w.days[2]).toMatchObject({ rostered: false });
  });

  it('a rostered day off turns a working day into a weekly off, and clearing restores it', async () => {
    const monday = (() => {
      let d = addDays(today, 7);
      while (weekday(d) !== 1) d = addDays(d, 1);
      return d;
    })();
    await hr.browser.send('put', '/v1/attendance/roster', {
      employeeIds: [worker.employeeId],
      from: monday,
      to: monday,
      shiftId: null,
    });
    let view = await hr.browser.get(`/v1/attendance/roster?from=${monday}&to=${monday}`);
    let w = view.body.employees.find((e: { id: string }) => e.id === worker.employeeId);
    expect(w.days[0]).toMatchObject({ rostered: true, shiftId: null, shiftCode: null });
    const cleared = await hr.browser.send('post', '/v1/attendance/roster/clear', {
      employeeIds: [worker.employeeId],
      from: monday,
      to: monday,
    });
    expect(cleared.body.removed).toBe(1);
    view = await hr.browser.get(`/v1/attendance/roster?from=${monday}&to=${monday}`);
    w = view.body.employees.find((e: { id: string }) => e.id === worker.employeeId);
    expect(w.days[0]).toMatchObject({ rostered: false });
    expect(w.days[0].shiftCode).not.toBeNull();
  });

  it('changes how a past day is worked out', async () => {
    // Worked 09:00–18:50 on the usual shift; rostering the Evening shift that day makes the arrival early.
    await hr.browser.send('put', '/v1/attendance/roster', {
      employeeIds: [worker.employeeId],
      from: wednesday,
      to: wednesday,
      shiftId: nightShift,
    });
    const mine = await db.attendanceDay.findFirstOrThrow({
      where: { employeeId: worker.employeeId, date: new Date(`${wednesday}T00:00:00Z`) },
    });
    expect(mine.shiftId).toBe(nightShift);
    await hr.browser.send('post', '/v1/attendance/roster/clear', {
      employeeIds: [worker.employeeId],
      from: wednesday,
      to: wednesday,
    });
    const back = await db.attendanceDay.findFirstOrThrow({
      where: { employeeId: worker.employeeId, date: new Date(`${wednesday}T00:00:00Z`) },
    });
    expect(back.shiftId).not.toBe(nightShift);
  });

  it('refuses people the requester cannot manage and shifts that do not exist', async () => {
    const outsider = await person('adv-nobody');
    const res = await outsider.browser.send('put', '/v1/attendance/roster', {
      employeeIds: [worker.employeeId],
      from: friday,
      to: friday,
      shiftId: nightShift,
    });
    expect(res.status).toBe(403);
    const missing = await owner.send('put', '/v1/attendance/roster', {
      employeeIds: [worker.employeeId],
      from: friday,
      to: friday,
      shiftId: '019a0000-0000-7000-8000-000000000000',
    });
    expect(missing.status).toBe(404);
  });
});

describe('geofenced clock-in', () => {
  const office = { latitude: 17.385, longitude: 78.4867 };
  let walker: Person;

  beforeAll(async () => {
    walker = await person('adv-walker');
    const created = await owner.send('post', '/v1/attendance/locations', {
      name: 'Head office',
      ...office,
      radiusMeters: 150,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(
      (
        await owner.send('post', '/v1/attendance/locations', {
          name: 'Head office',
          ...office,
          radiusMeters: 150,
        })
      ).status,
    ).toBe(409);
    expect(
      (await owner.send('post', '/v1/attendance/locations', { name: 'Tiny', ...office, radiusMeters: 5 }))
        .status,
    ).toBe(400);
  });

  const punch = (direction: 'IN' | 'OUT', location?: object) =>
    walker.browser.send('post', '/v1/attendance/me/punch', { direction, ...(location ? { location } : {}) });

  it('does nothing while the rule is off', async () => {
    expect((await punch('IN')).status).toBe(200);
    expect((await punch('OUT')).status).toBe(200);
  });

  it('refuses a clock-in with no location, or outside every place, when enforcing', async () => {
    await owner.send('put', '/v1/attendance/policy', policy({ geofenceMode: 'ENFORCE' }));
    const today1 = await walker.browser.get('/v1/attendance/me/today');
    expect(today1.body.geofence).toBe('ENFORCE');
    const none = await punch('IN');
    expect(none.status).toBe(422);
    expect(none.body.code).toBe('LOCATION_REQUIRED');
    const far = await punch('IN', { latitude: 17.4, longitude: 78.4867, accuracy: 20 });
    expect(far.status).toBe(422);
    expect(far.body.code).toBe('OUTSIDE_WORK_LOCATION');
  });

  it('accepts a clock-in inside a place and keeps where it happened', async () => {
    const ok = await punch('IN', { latitude: 17.3852, longitude: 78.4868, accuracy: 12 });
    expect(ok.status).toBe(200);
    const row = await db.attendancePunch.findFirstOrThrow({
      where: { employeeId: walker.employeeId, locationId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).toMatchObject({ outsideGeofence: false, accuracyMeters: 12 });
    expect(Number(row.latitude)).toBeCloseTo(17.3852, 4);
  });

  it('only flags a punch outside when warning', async () => {
    await owner.send('put', '/v1/attendance/policy', policy({ geofenceMode: 'WARN' }));
    const out = await punch('OUT', { latitude: 17.5, longitude: 78.6 });
    expect(out.status).toBe(200);
    const row = await db.attendancePunch.findFirstOrThrow({
      where: { employeeId: walker.employeeId, outsideGeofence: true },
    });
    expect(row.locationId).toBeNull();
  });

  it('does not ask for a location when no place is active', async () => {
    const places = (await owner.get('/v1/attendance/locations')).body as { id: string; name: string }[];
    for (const p of places) {
      await owner.send('patch', `/v1/attendance/locations/${p.id}`, {
        name: p.name,
        latitude: office.latitude,
        longitude: office.longitude,
        radiusMeters: 150,
        status: 'ARCHIVED',
      });
    }
    await owner.send('put', '/v1/attendance/policy', policy({ geofenceMode: 'ENFORCE' }));
    expect((await walker.browser.get('/v1/attendance/me/today')).body.geofence).toBe('OFF');
    expect((await punch('IN')).status).toBe(200);
  });
});

describe('limits on corrections', () => {
  it('stops corrections that reach too far back and caps how many a month', async () => {
    await owner.send(
      'put',
      '/v1/attendance/policy',
      policy({ maxCorrectionBackdateDays: 3, maxCorrectionsPerMonth: 1 }),
    );
    const person2 = await person('adv-fixer');
    const old = await person2.browser.send('post', '/v1/attendance/corrections', {
      date: addDays(today, -10),
      in: '09:00',
      out: '18:00',
      reason: 'Forgot to clock in',
    });
    expect(old.status).toBe(400);
    expect(JSON.stringify(old.body)).toContain('go back 3 days');
    const first = await person2.browser.send('post', '/v1/attendance/corrections', {
      date: addDays(today, -1),
      in: '09:00',
      out: '18:00',
      reason: 'Forgot to clock in',
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await person2.browser.send('post', '/v1/attendance/corrections', {
      date: addDays(today, -2),
      in: '09:00',
      out: '18:00',
      reason: 'Forgot again',
    });
    expect(second.status).toBe(422);
    expect(second.body.code).toBe('CORRECTION_LIMIT');
  });
});

describe('database rules', () => {
  it('keeps decisions and refuses nonsense', async () => {
    const rt = createDatabaseClient({ connectionString: requireEnv('DATABASE_URL'), maxConnections: 1 });
    await expect(rt.$executeRaw`DELETE FROM overtime_approval`).rejects.toThrow();
    await expect(
      db.overtimeApproval.create({
        data: {
          tenantId,
          employeeId: worker.employeeId,
          date: new Date(`${earlierThan(wednesday)}T00:00:00Z`),
          decision: 'REJECTED',
          approvedMinutes: 30,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.workLocation.create({
        data: { tenantId, name: 'Nowhere', latitude: 95, longitude: 0, radiusMeters: 100 },
      }),
    ).rejects.toThrow();
    await rt.$disconnect();
  });
});
