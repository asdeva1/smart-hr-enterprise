/**
 * Attendance arithmetic, kept free of the database so it can be tested exhaustively. Every rule works in the
 * employee's own time zone: a shift that starts at 09:00 in Asia/Kolkata starts at 03:30 UTC.
 */

export interface ShiftRule {
  id: string;
  startMinute: number;
  endMinute: number;
  breakMinutes: number;
  graceMinutes: number;
  halfDayMinutes: number;
  fullDayMinutes: number;
  weeklyOffs: number[];
}

export interface Punch {
  at: Date;
  direction: 'IN' | 'OUT';
}

export type DayStatus = 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'WEEKLY_OFF' | 'HOLIDAY' | 'ON_LEAVE';

/** What else is true of a date for one employee: a public holiday, or approved leave (all day or half). */
export interface DayMark {
  holiday: string | null;
  leave: 'FULL' | 'FIRST_HALF' | 'SECOND_HALF' | null;
  /** The leave type counts weekly offs and holidays as leave days ("sandwich" rule). */
  leaveOnRestDays?: boolean;
}

export const NO_MARK: DayMark = { holiday: null, leave: null };

/** Leave covers a rest day only when its type counts rest days; otherwise the rest day stands. */
function effectiveLeave(mark: DayMark, restDay: boolean): DayMark['leave'] {
  return restDay && !mark.leaveOnRestDays ? null : mark.leave;
}

export interface DayResult {
  status: DayStatus;
  firstIn: Date | null;
  lastOut: Date | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  /** Clocked in with no clock-out yet. Only meaningful for today. */
  openSince: Date | null;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** The calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Minutes after local midnight of an instant in a time zone. */
export function localMinute(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

/** How far ahead of UTC a time zone is at an instant, in minutes (e.g. +330 for India). */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / MINUTE_MS);
}

/** The instant of a local date and minute in a time zone (minute may exceed a day, for night shifts). */
export function zonedInstant(date: string, minute: number, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d) + minute * MINUTE_MS;
  // Two passes settle the offset across daylight-saving changes.
  let guess = naive - offsetMinutes(new Date(naive), timeZone) * MINUTE_MS;
  guess = naive - offsetMinutes(new Date(guess), timeZone) * MINUTE_MS;
  return new Date(guess);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  return new Date(d.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function crossesMidnight(shift: Pick<ShiftRule, 'startMinute' | 'endMinute'>): boolean {
  return shift.endMinute <= shift.startMinute;
}

/** Start and end instants of a shift on a local date. */
export function shiftWindow(shift: ShiftRule, date: string, timeZone: string): { start: Date; end: Date } {
  const end = crossesMidnight(shift) ? shift.endMinute + 1440 : shift.endMinute;
  return { start: zonedInstant(date, shift.startMinute, timeZone), end: zonedInstant(date, end, timeZone) };
}

/**
 * The attendance date a punch counts towards. For a night shift (say 22:00–06:00), a punch in the early
 * morning belongs to the shift that started the evening before: anything before the shift's end plus four
 * hours counts towards the previous date.
 */
export function attendanceDateFor(at: Date, shift: ShiftRule | null, timeZone: string): string {
  const date = localDate(at, timeZone);
  if (
    shift &&
    crossesMidnight(shift) &&
    localMinute(at, timeZone) < Math.min(shift.endMinute + 240, shift.startMinute)
  ) {
    return addDays(date, -1);
  }
  return date;
}

/**
 * Works out a day from its punches. Worked time is the sum of each clock-in to the next clock-out; a
 * clock-in with no clock-out counts only up to `now` and only on the current day. Lateness is measured from
 * the shift start once arrival is past the grace period; leaving early, from the shift end.
 *
 * Approved leave and holidays change the meaning: a full day of leave is ON_LEAVE; a weekly off or holiday
 * is not a working day (time worked on it is overtime); with half a day of leave, working the other half is
 * a full day, and lateness or leaving early is only measured for the half that was meant to be worked.
 */
export function computeDay(input: {
  date: string;
  shift: ShiftRule;
  punches: Punch[];
  timeZone: string;
  now: Date;
  mark?: DayMark;
}): DayResult {
  const { date, shift, timeZone, now } = input;
  const mark = input.mark ?? NO_MARK;
  const punches = [...input.punches].sort((a, b) => a.at.getTime() - b.at.getTime());
  const isToday = attendanceDateFor(now, shift, timeZone) === date;
  const weeklyOff = shift.weeklyOffs.includes(weekday(date));
  const offDay = weeklyOff || !!mark.holiday;
  const leave = effectiveLeave(mark, offDay);

  let worked = 0;
  let openSince: Date | null = null;
  for (const p of punches) {
    if (p.direction === 'IN') {
      openSince ??= p.at;
    } else if (openSince) {
      worked += (p.at.getTime() - openSince.getTime()) / MINUTE_MS;
      openSince = null;
    }
  }
  if (openSince && isToday) worked += Math.max(0, (now.getTime() - openSince.getTime()) / MINUTE_MS);
  const workedMinutes = Math.floor(worked);

  const firstIn = punches.find((p) => p.direction === 'IN')?.at ?? null;
  const lastOut = [...punches].reverse().find((p) => p.direction === 'OUT')?.at ?? null;
  const window = shiftWindow(shift, date, timeZone);

  if (leave === 'FULL') {
    return {
      status: 'ON_LEAVE',
      firstIn,
      lastOut,
      workedMinutes,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      overtimeMinutes: 0,
      openSince: isToday ? openSince : null,
    };
  }

  if (offDay) {
    const restDay = weeklyOff ? 'WEEKLY_OFF' : 'HOLIDAY';
    return {
      status: punches.length && workedMinutes >= shift.halfDayMinutes ? 'PRESENT' : restDay,
      firstIn,
      lastOut,
      workedMinutes,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      // Everything worked on a day off is extra.
      overtimeMinutes: workedMinutes,
      openSince: isToday ? openSince : null,
    };
  }

  const lateBy = firstIn ? Math.floor((firstIn.getTime() - window.start.getTime()) / MINUTE_MS) : 0;
  // Morning off: arriving after lunch isn't late. Afternoon off: leaving at lunch isn't early.
  const lateMinutes = leave !== 'FIRST_HALF' && lateBy > shift.graceMinutes ? lateBy : 0;
  const leftEarlyBy =
    lastOut && !(isToday && openSince) && leave !== 'SECOND_HALF'
      ? Math.floor((window.end.getTime() - lastOut.getTime()) / MINUTE_MS)
      : 0;
  const fullDay = shiftLengthMinutes(shift) - shift.breakMinutes;
  const expected = leave ? Math.floor(fullDay / 2) : fullDay;

  let status: DayStatus;
  if (leave) {
    // Half a day of leave: the other half worked makes a full day; otherwise only the leave half counts.
    status = workedMinutes >= shift.halfDayMinutes || (isToday && openSince) ? 'PRESENT' : 'HALF_DAY';
  } else if (workedMinutes >= shift.fullDayMinutes) status = 'PRESENT';
  else if (workedMinutes >= shift.halfDayMinutes) status = 'HALF_DAY';
  // Today isn't over: someone clocked in counts as present until the day is done.
  else if (isToday && openSince) status = 'PRESENT';
  else status = 'ABSENT';

  return {
    status,
    firstIn,
    lastOut,
    workedMinutes,
    lateMinutes,
    earlyLeaveMinutes: Math.max(0, leftEarlyBy),
    overtimeMinutes: Math.max(0, workedMinutes - expected),
    openSince: isToday ? openSince : null,
  };
}

export function shiftLengthMinutes(shift: Pick<ShiftRule, 'startMinute' | 'endMinute'>): number {
  return crossesMidnight(shift)
    ? shift.endMinute + 1440 - shift.startMinute
    : shift.endMinute - shift.startMinute;
}

/**
 * What a day with no stored result means: leave, a weekly off or holiday, an absence (a past working day
 * while employed), or nothing yet (today, the future, before joining or after leaving). Leave, holidays and
 * weekly offs show ahead of time too, so calendars can show them.
 */
export function implicitDay(input: {
  date: string;
  shift: ShiftRule;
  today: string;
  joinedOn: string;
  leftOn: string | null;
  mark?: DayMark;
}): DayStatus | null {
  const { date, shift, today, joinedOn, leftOn } = input;
  const mark = input.mark ?? NO_MARK;
  if (date < joinedOn || (leftOn && date > leftOn)) return null;
  const weeklyOff = shift.weeklyOffs.includes(weekday(date));
  const leave = effectiveLeave(mark, weeklyOff || !!mark.holiday);
  if (leave === 'FULL') return 'ON_LEAVE';
  if (weeklyOff) return 'WEEKLY_OFF';
  if (mark.holiday) return 'HOLIDAY';
  if (leave) return date < today ? 'HALF_DAY' : 'ON_LEAVE';
  return date < today ? 'ABSENT' : null;
}

// ---- Overtime rules -------------------------------------------------------------------------------

export interface OvertimePolicy {
  enabled: boolean;
  /** Minutes beyond the full day that do not count (working days only). */
  thresholdMinutes: number;
  /** Overtime is rounded down to a multiple of this. */
  roundMinutes: number;
  /** The most that counts on one day; null = no limit. */
  dailyCapMinutes: number | null;
  /** Work on a weekly off or holiday counts. */
  offDayCounts: boolean;
}

/** What organisations without a policy get: everything beyond the day counts, to the minute. */
export const LEGACY_OVERTIME: OvertimePolicy = {
  enabled: true,
  thresholdMinutes: 0,
  roundMinutes: 1,
  dailyCapMinutes: null,
  offDayCounts: true,
};

/** Turns the raw extra minutes of a day into the overtime the organisation counts. */
export function applyOvertimePolicy(raw: number, policy: OvertimePolicy, offDay: boolean): number {
  if (!policy.enabled || raw <= 0) return 0;
  if (offDay && !policy.offDayCounts) return 0;
  let minutes = offDay ? raw : raw - policy.thresholdMinutes;
  if (minutes <= 0) return 0;
  const step = Math.max(1, policy.roundMinutes);
  minutes = Math.floor(minutes / step) * step;
  if (policy.dailyCapMinutes !== null) minutes = Math.min(minutes, policy.dailyCapMinutes);
  return Math.max(0, minutes);
}

// ---- Geofence -------------------------------------------------------------------------------------

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface GeoLocation extends GeoPoint {
  id: string;
  name: string;
  radiusMeters: number;
}

/** Great-circle distance between two points, in metres (haversine). */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Which work location a point is inside. A poor GPS fix widens nothing in the employee's favour: the
 * reported accuracy is not added to the radius, so a weak signal near the edge is treated as outside.
 */
export function insideLocation(point: GeoPoint, locations: readonly GeoLocation[]): GeoLocation | null {
  let best: { location: GeoLocation; distance: number } | null = null;
  for (const location of locations) {
    const distance = distanceMeters(point, location);
    if (distance <= location.radiusMeters && (!best || distance < best.distance))
      best = { location, distance };
  }
  return best?.location ?? null;
}
