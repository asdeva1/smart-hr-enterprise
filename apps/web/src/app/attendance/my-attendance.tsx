'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import type { SessionView } from '@/lib/api';
import { apiFetch } from '@/lib/api';
import {
  attendanceKeys,
  clockTime,
  CORRECTION_LABEL,
  CORRECTION_TONE,
  DAY_LABEL,
  DAY_TONE,
  hoursAndMinutes,
  minutesToClock,
  monthLabel,
  monthRange,
  shiftMonth,
  useCorrections,
  useMyDays,
  useToday,
  WEEKDAYS,
  type DayView,
  type Today,
} from '@/lib/attendance';
import { formatDay } from '@/lib/employees';
import { cn } from '@/lib/utils';
import { AttendanceTabs } from './attendance-tabs';
import { CorrectionDialog } from './correction-dialog';

export function MyAttendance({ session }: { session: SessionView }) {
  const today = useToday();
  const [month, setMonth] = useState<string>();
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>();

  if (today.isPending) return <Loading />;
  if (today.isError) return <Alert tone="error">{errorMessage(today.error)}</Alert>;

  const data = today.data;
  const shownMonth = month ?? ('date' in data ? data.date.slice(0, 7) : '');

  return (
    <>
      <PageHeader title="Attendance" description="Clock in and out, and see your days." />
      <AttendanceTabs session={session} active="/attendance" />
      {!data.employee ? (
        <EmptyState title="Your account isn’t linked to an employee record">
          Clocking in needs an employee record. Ask HR to link your account to yours.
        </EmptyState>
      ) : (
        <>
          {notice && <Alert tone="success">{notice}</Alert>}
          <TodayCard today={data} />
          <MonthCalendar
            month={shownMonth}
            timeZone={data.timeZone}
            today={data.date}
            onMonth={setMonth}
            onCorrect={(date) => setCorrecting(date)}
          />
          <MyCorrections timeZone={data.timeZone} onNew={() => setCorrecting(data.date)} />
          {correcting && (
            <CorrectionDialog
              initialDate={correcting}
              onClose={() => setCorrecting(null)}
              onDone={() => {
                setCorrecting(null);
                setNotice('Correction sent for approval. Your manager has been notified.');
              }}
            />
          )}
        </>
      )}
    </>
  );
}

/** The browser's position, or nothing if the person declines or the device can't tell. */
function currentPosition(): Promise<{ latitude: number; longitude: number; accuracy: number } | undefined> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return Promise.resolve(undefined);
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(undefined),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    ),
  );
}

function TodayCard({ today }: { today: Today }) {
  const client = useQueryClient();
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const punch = useMutation({
    mutationFn: async (direction: 'IN' | 'OUT') => {
      // When the organisation checks where people clock in from, send the browser's position with the punch.
      const location = (today.geofence ?? 'OFF') === 'OFF' ? undefined : await currentPosition();
      return apiFetch<Today>('/v1/attendance/me/punch', {
        method: 'POST',
        body: { direction, ...(location ? { location } : {}) },
      });
    },
    onSuccess: async (next) => {
      setError(undefined);
      client.setQueryData(attendanceKeys.today, next);
      await client.invalidateQueries({ queryKey: ['attendance', 'my-days'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const { result, shift, timeZone } = today;
  const open = result.openSince ? Math.floor((now - new Date(result.openSince).getTime()) / 60_000) : 0;
  const worked = result.openSince ? Math.max(result.workedMinutes, open) : result.workedMinutes;
  const clockedIn = today.nextAction === 'OUT';

  return (
    <section
      aria-labelledby="today-heading"
      className="flex flex-wrap items-center gap-6 rounded-lg border border-border bg-card p-6"
    >
      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
        <h2 id="today-heading" className="text-[13px] font-medium text-muted-foreground">
          Today · {formatDay(today.date)}
        </h2>
        <p className="text-[28px] leading-tight font-semibold tabular-nums">
          {clockedIn
            ? `In since ${clockTime(result.openSince, timeZone)}`
            : result.firstIn
              ? 'Clocked out'
              : 'Not clocked in'}
        </p>
        <p className="text-[13px] text-muted-foreground">
          {shift.name} · {minutesToClock(shift.startMinute)}–{minutesToClock(shift.endMinute)}
          {timeZone !== 'Asia/Kolkata' ? ` (${timeZone})` : ''}
        </p>
        {(today.holiday || today.leave) && (
          <p className="text-[13px] font-medium text-info">
            {today.leave === 'FULL'
              ? 'You’re on leave today.'
              : today.leave
                ? `On leave for the ${today.leave === 'FIRST_HALF' ? 'morning' : 'afternoon'}.`
                : `Holiday: ${today.holiday}.`}
          </p>
        )}
      </div>
      <dl className="flex flex-[1_1_260px] gap-6 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Worked</dt>
          <dd className="font-semibold tabular-nums">{hoursAndMinutes(worked)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">First in</dt>
          <dd className="tabular-nums">{clockTime(result.firstIn, timeZone)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Late by</dt>
          <dd className="tabular-nums">{result.lateMinutes ? hoursAndMinutes(result.lateMinutes) : '—'}</dd>
        </div>
      </dl>
      <div className="flex flex-col items-stretch gap-2">
        <Button
          size="lg"
          variant={clockedIn ? 'outline' : 'primary'}
          disabled={!today.canPunch || punch.isPending}
          onClick={() => punch.mutate(today.nextAction)}
        >
          {clockedIn ? 'Clock out' : 'Clock in'}
        </Button>
        {error && <span className="text-[13px] text-danger">{error}</span>}
      </div>
      {today.punches.length > 0 && (
        <ol aria-label="Today’s clock-ins" className="flex w-full flex-wrap gap-2 text-[13px]">
          {today.punches.map((p) => (
            <li key={p.id} className="rounded-md bg-muted px-2.5 py-1 tabular-nums">
              {p.direction === 'IN' ? 'In' : 'Out'} {clockTime(p.at, timeZone)}
              {p.source !== 'WEB' && (
                <span className="text-muted-foreground"> · {p.source.toLowerCase()}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function MonthCalendar({
  month,
  timeZone,
  today,
  onMonth,
  onCorrect,
}: {
  month: string;
  timeZone: string;
  today: string;
  onMonth: (m: string) => void;
  onCorrect: (date: string) => void;
}) {
  const { from, to } = monthRange(month);
  const days = useMyDays(from, to);
  const lead = new Date(`${from}T00:00:00Z`).getUTCDay();
  const totals = (days.data?.days ?? []).reduce(
    (t, d) => {
      if (d.status === 'PRESENT') t.present++;
      else if (d.status === 'HALF_DAY') t.half++;
      else if (d.status === 'ABSENT') t.absent++;
      if (d.lateMinutes > 0) t.late++;
      return t;
    },
    { present: 0, half: 0, absent: 0, late: 0 },
  );

  return (
    <section
      aria-labelledby="month-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="month-heading" className="font-semibold">
          {monthLabel(month)}
        </h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onMonth(shiftMonth(month, -1))}>
            Previous<span className="sr-only"> month</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={month >= today.slice(0, 7)}
            onClick={() => onMonth(shiftMonth(month, 1))}
          >
            Next<span className="sr-only"> month</span>
          </Button>
        </div>
      </div>
      <p className="text-[13px] text-muted-foreground">
        {totals.present} present · {totals.half} half days · {totals.absent} absent · {totals.late} late
      </p>
      {days.isPending ? (
        <Loading />
      ) : days.isError ? (
        <Alert tone="error">{errorMessage(days.error)}</Alert>
      ) : (
        <div className="overflow-x-auto">
          <div
            role="grid"
            aria-label={`Days in ${monthLabel(month)}`}
            className="grid min-w-[560px] grid-cols-7 gap-1.5"
          >
            {WEEKDAYS.map((w) => (
              <div key={w} role="columnheader" className="pb-1 text-center text-xs text-muted-foreground">
                {w}
              </div>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <div key={`lead-${i}`} aria-hidden="true" />
            ))}
            {days.data.days.map((d) => (
              <DayCell
                key={d.date}
                day={d}
                timeZone={timeZone}
                isToday={d.date === today}
                onCorrect={onCorrect}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function DayCell({
  day,
  timeZone,
  isToday,
  onCorrect,
}: {
  day: DayView;
  timeZone: string;
  isToday: boolean;
  onCorrect: (date: string) => void;
}) {
  // Corrections are for working days that have happened; leave and holidays aren't corrected here.
  const past = !!day.status && !['WEEKLY_OFF', 'HOLIDAY', 'ON_LEAVE'].includes(day.status);
  const tone = day.status ? DAY_TONE[day.status] : null;
  return (
    <div
      role="gridcell"
      className={cn(
        'flex min-h-[86px] flex-col gap-1 rounded-md border p-2 text-xs',
        isToday ? 'border-primary' : 'border-border',
        tone === 'danger' && 'bg-danger-soft/40',
        tone === 'neutral' && 'bg-muted/60',
      )}
    >
      <span className="flex items-center justify-between">
        <span className="font-semibold tabular-nums">{Number(day.date.slice(8))}</span>
        {day.lateMinutes > 0 && <span className="text-warning">Late</span>}
      </span>
      {day.status && <Badge tone={DAY_TONE[day.status]}>{DAY_LABEL[day.status]}</Badge>}
      {day.holiday && <span className="text-muted-foreground">{day.holiday}</span>}
      {day.firstIn && (
        <span className="text-muted-foreground tabular-nums">
          {clockTime(day.firstIn, timeZone)}–{day.lastOut ? clockTime(day.lastOut, timeZone) : '…'}
        </span>
      )}
      {day.corrected && <span className="text-muted-foreground">Corrected</span>}
      {past && (
        <button
          type="button"
          className="mt-auto self-start text-primary hover:underline"
          onClick={() => onCorrect(day.date)}
        >
          Correct<span className="sr-only"> {formatDay(day.date)}</span>
        </button>
      )}
    </div>
  );
}

function MyCorrections({ timeZone, onNew }: { timeZone: string; onNew: () => void }) {
  const corrections = useCorrections('mine');
  return (
    <section aria-labelledby="corrections-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="corrections-heading" className="text-[17px] font-semibold">
          My corrections
        </h2>
        <Button size="sm" variant="outline" onClick={onNew}>
          Ask for a correction
        </Button>
      </div>
      {corrections.isPending ? (
        <Loading />
      ) : corrections.isError ? (
        <Alert tone="error">{errorMessage(corrections.error)}</Alert>
      ) : corrections.data.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">None yet.</p>
      ) : (
        <Table label="My corrections">
          <thead>
            <tr>
              <Th>Day</Th>
              <Th>In</Th>
              <Th>Out</Th>
              <Th>Reason</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {corrections.data.map((c) => (
              <tr key={c.id}>
                <Td>
                  <Link href={`/attendance/corrections/${c.id}`} className="text-primary hover:underline">
                    {formatDay(c.date)}
                  </Link>
                </Td>
                <Td className="tabular-nums">{clockTime(c.inAt, timeZone)}</Td>
                <Td className="tabular-nums">{clockTime(c.outAt, timeZone)}</Td>
                <Td>{c.reason}</Td>
                <Td>
                  <Badge tone={CORRECTION_TONE[c.status]}>{CORRECTION_LABEL[c.status]}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}
