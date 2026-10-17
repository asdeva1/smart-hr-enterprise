import { describe, expect, it } from 'vitest';
import {
  addDays,
  attendanceDateFor,
  computeDay,
  implicitDay,
  localDate,
  localMinute,
  shiftWindow,
  zonedInstant,
  type DayMark,
  type Punch,
  type ShiftRule,
} from './attendance-calc.js';

const IST = 'Asia/Kolkata';
const NY = 'America/New_York';

const general: ShiftRule = {
  id: 'gen',
  startMinute: 9 * 60,
  endMinute: 18 * 60,
  breakMinutes: 60,
  graceMinutes: 10,
  halfDayMinutes: 240,
  fullDayMinutes: 480,
  weeklyOffs: [0],
};
const night: ShiftRule = { ...general, id: 'night', startMinute: 22 * 60, endMinute: 6 * 60 };

/** A punch at a local IST wall-clock time. */
const at = (date: string, hhmm: string, direction: Punch['direction'], tz = IST): Punch => ({
  at: zonedInstant(date, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), tz),
  direction,
});
const later = new Date('2030-01-01T00:00:00Z');

describe('time zones', () => {
  it('converts local wall-clock times to instants and back', () => {
    const i = zonedInstant('2026-10-14', 9 * 60, IST);
    expect(i.toISOString()).toBe('2026-10-14T03:30:00.000Z');
    expect(localDate(i, IST)).toBe('2026-10-14');
    expect(localMinute(i, IST)).toBe(540);
    // 23:30 UTC is already the next day in India.
    expect(localDate(new Date('2026-10-14T23:30:00Z'), IST)).toBe('2026-10-15');
  });

  it('handles daylight-saving changes', () => {
    // New York moves from EDT (-4) to EST (-5) on 2026-11-01.
    expect(zonedInstant('2026-10-31', 9 * 60, NY).toISOString()).toBe('2026-10-31T13:00:00.000Z');
    expect(zonedInstant('2026-11-02', 9 * 60, NY).toISOString()).toBe('2026-11-02T14:00:00.000Z');
  });

  it('places a night shift across midnight', () => {
    const w = shiftWindow(night, '2026-10-14', IST);
    expect(w.start.toISOString()).toBe('2026-10-14T16:30:00.000Z');
    expect(w.end.toISOString()).toBe('2026-10-15T00:30:00.000Z');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('which day a punch belongs to', () => {
  it('counts early-morning punches of a night shift towards the evening before', () => {
    expect(attendanceDateFor(at('2026-10-15', '05:55', 'OUT').at, night, IST)).toBe('2026-10-14');
    expect(attendanceDateFor(at('2026-10-14', '21:50', 'IN').at, night, IST)).toBe('2026-10-14');
    expect(attendanceDateFor(at('2026-10-15', '05:55', 'OUT').at, general, IST)).toBe('2026-10-15');
  });
});

describe('a working day', () => {
  const day = (punches: Punch[], date = '2026-10-14', now = later, shift = general) =>
    computeDay({ date, shift, punches, timeZone: IST, now });

  it('is a full day with no lateness for 09:05–18:00', () => {
    const r = day([at('2026-10-14', '09:05', 'IN'), at('2026-10-14', '18:00', 'OUT')]);
    expect(r).toMatchObject({ status: 'PRESENT', workedMinutes: 535, lateMinutes: 0, earlyLeaveMinutes: 0 });
    expect(r.overtimeMinutes).toBe(55); // 9h shift less 1h break = 8h expected
  });

  it('marks lateness past the grace period from the shift start', () => {
    const r = day([at('2026-10-14', '09:25', 'IN'), at('2026-10-14', '18:30', 'OUT')]);
    expect(r).toMatchObject({ status: 'PRESENT', lateMinutes: 25 });
  });

  it('is a half day between the half-day and full-day thresholds, and records leaving early', () => {
    const r = day([at('2026-10-14', '09:00', 'IN'), at('2026-10-14', '14:00', 'OUT')]);
    expect(r).toMatchObject({ status: 'HALF_DAY', workedMinutes: 300, earlyLeaveMinutes: 240 });
  });

  it('is absent when too little was worked, and adds up several in-out pairs', () => {
    expect(day([at('2026-10-14', '09:00', 'IN'), at('2026-10-14', '10:00', 'OUT')]).status).toBe('ABSENT');
    const split = day([
      at('2026-10-14', '09:00', 'IN'),
      at('2026-10-14', '13:00', 'OUT'),
      at('2026-10-14', '14:00', 'IN'),
      at('2026-10-14', '18:00', 'OUT'),
    ]);
    expect(split).toMatchObject({ status: 'PRESENT', workedMinutes: 480 });
  });

  it('ignores an unmatched clock-out and a past clock-in that was never closed', () => {
    const r = day([at('2026-10-14', '08:00', 'OUT'), at('2026-10-14', '09:00', 'IN')]);
    expect(r).toMatchObject({ status: 'ABSENT', workedMinutes: 0, openSince: null });
  });

  it('counts an open clock-in up to now on the current day, and shows it as present', () => {
    const now = at('2026-10-14', '11:00', 'IN').at;
    const r = day([at('2026-10-14', '09:00', 'IN')], '2026-10-14', now);
    expect(r).toMatchObject({ status: 'PRESENT', workedMinutes: 120, earlyLeaveMinutes: 0 });
    expect(r.openSince?.toISOString()).toBe('2026-10-14T03:30:00.000Z');
  });

  it('treats work on a weekly off as overtime', () => {
    const sunday = '2026-10-18';
    const r = day([at(sunday, '10:00', 'IN'), at(sunday, '15:00', 'OUT')], sunday);
    expect(r).toMatchObject({ status: 'PRESENT', overtimeMinutes: 300, lateMinutes: 0 });
    expect(day([], sunday).status).toBe('WEEKLY_OFF');
  });

  it('works out a night shift across midnight', () => {
    const r = day(
      [at('2026-10-14', '22:00', 'IN'), at('2026-10-15', '06:00', 'OUT')],
      '2026-10-14',
      later,
      night,
    );
    expect(r).toMatchObject({ status: 'PRESENT', workedMinutes: 480, lateMinutes: 0, earlyLeaveMinutes: 0 });
  });
});

describe('days with no record', () => {
  const base = { shift: general, today: '2026-10-16', joinedOn: '2026-10-01', leftOn: null };
  it('reads past working days as absent and Sundays as weekly off, within employment only', () => {
    expect(implicitDay({ ...base, date: '2026-10-14' })).toBe('ABSENT');
    expect(implicitDay({ ...base, date: '2026-10-11' })).toBe('WEEKLY_OFF');
    expect(implicitDay({ ...base, date: '2026-10-16' })).toBeNull();
    expect(implicitDay({ ...base, date: '2026-09-30' })).toBeNull();
    expect(implicitDay({ ...base, leftOn: '2026-10-10', date: '2026-10-14' })).toBeNull();
  });
});

describe('holidays and leave', () => {
  const d = '2026-10-14';
  const mark = (m: Partial<DayMark>): DayMark => ({ holiday: null, leave: null, ...m });
  const day = (punches: Punch[], m: Partial<DayMark>) =>
    computeDay({ date: d, shift: general, punches, timeZone: IST, now: later, mark: mark(m) });

  it('shows a full day of leave as on leave, whatever was punched', () => {
    expect(day([], { leave: 'FULL' }).status).toBe('ON_LEAVE');
    expect(day([at(d, '09:00', 'IN'), at(d, '10:00', 'OUT')], { leave: 'FULL' })).toMatchObject({
      status: 'ON_LEAVE',
      lateMinutes: 0,
      overtimeMinutes: 0,
    });
  });

  it('treats a holiday like a weekly off: not absent, and work on it is overtime', () => {
    expect(day([], { holiday: 'Diwali' }).status).toBe('HOLIDAY');
    expect(day([at(d, '10:00', 'IN'), at(d, '15:00', 'OUT')], { holiday: 'Diwali' })).toMatchObject({
      status: 'PRESENT',
      overtimeMinutes: 300,
    });
  });

  it('makes half a day of leave plus the other half worked a full day', () => {
    // Afternoon off: in on time, out at 13:30.
    const pm = day([at(d, '09:00', 'IN'), at(d, '13:30', 'OUT')], { leave: 'SECOND_HALF' });
    expect(pm).toMatchObject({ status: 'PRESENT', earlyLeaveMinutes: 0, lateMinutes: 0 });
    // Morning off: arriving at 13:30 isn't late.
    const am = day([at(d, '13:30', 'IN'), at(d, '18:00', 'OUT')], { leave: 'FIRST_HALF' });
    expect(am).toMatchObject({ status: 'PRESENT', lateMinutes: 0 });
    // Morning off and leaving at 16:00: too little of the afternoon worked, and leaving early counts.
    const early = day([at(d, '13:30', 'IN'), at(d, '16:00', 'OUT')], { leave: 'FIRST_HALF' });
    expect(early).toMatchObject({ status: 'HALF_DAY', earlyLeaveMinutes: 120 });
    // Nothing worked: only the leave half counts.
    expect(day([], { leave: 'SECOND_HALF' }).status).toBe('HALF_DAY');
  });

  it('reads days with no record ahead of time', () => {
    const base = { shift: general, today: '2026-10-16', joinedOn: '2026-10-01', leftOn: null };
    expect(implicitDay({ ...base, date: '2026-10-20', mark: mark({ leave: 'FULL' }) })).toBe('ON_LEAVE');
    expect(implicitDay({ ...base, date: '2026-10-20', mark: mark({ holiday: 'Diwali' }) })).toBe('HOLIDAY');
    expect(implicitDay({ ...base, date: '2026-10-14', mark: mark({ leave: 'FIRST_HALF' }) })).toBe(
      'HALF_DAY',
    );
    expect(implicitDay({ ...base, date: '2026-10-18', mark: mark({ holiday: 'Sunday holiday' }) })).toBe(
      'WEEKLY_OFF',
    );
    // Leave never applies outside employment.
    expect(implicitDay({ ...base, date: '2026-09-20', mark: mark({ leave: 'FULL' }) })).toBeNull();
  });
});

describe('leave on rest days', () => {
  const base = { shift: general, today: '2026-10-16', joinedOn: '2026-01-01', leftOn: null };
  it('leaves weekly offs and holidays as they are, unless the leave type counts them', () => {
    const sunday = '2026-10-18';
    const leave = { holiday: null, leave: 'FULL' as const };
    expect(implicitDay({ ...base, date: sunday, mark: leave })).toBe('WEEKLY_OFF');
    expect(implicitDay({ ...base, date: sunday, mark: { ...leave, leaveOnRestDays: true } })).toBe(
      'ON_LEAVE',
    );
    const holiday = { holiday: 'Diwali', leave: 'FULL' as const };
    expect(implicitDay({ ...base, date: '2026-10-20', mark: holiday })).toBe('HOLIDAY');
    expect(
      computeDay({
        date: '2026-10-20',
        shift: general,
        punches: [],
        timeZone: IST,
        now: later,
        mark: holiday,
      }).status,
    ).toBe('HOLIDAY');
  });
});
