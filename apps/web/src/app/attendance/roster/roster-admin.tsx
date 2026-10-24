'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import { WEEKDAYS } from '@/lib/attendance';
import { advancedKeys, mondayOf, shiftDate, type RosterView } from '@/lib/attendance-advanced';
import { todayIso } from '@/lib/employees';
import { cn } from '@/lib/utils';
import { AttendanceTabs } from '../attendance-tabs';

const dayLabel = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  return { weekday: WEEKDAYS[d.getUTCDay()]!, day: d.getUTCDate() };
};

export function RosterAdmin({ session }: { session: SessionView }) {
  const [from, setFrom] = useState(() => mondayOf(todayIso()));
  const [search, setSearch] = useState('');
  const to = shiftDate(from, 13);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<'set' | 'clear' | null>(null);
  const [notice, setNotice] = useState<string>();
  const roster = useQuery({
    queryKey: advancedKeys.roster(from, to, search),
    queryFn: () =>
      apiFetch<RosterView>(
        `/v1/attendance/roster?from=${from}&to=${to}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
  });

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Put people on a different shift, or a day off, for particular dates. A rostered date replaces their usual shift."
        actions={
          <span className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={picked.size === 0} onClick={() => setDialog('clear')}>
              Back to usual shift
            </Button>
            <Button disabled={picked.size === 0} onClick={() => setDialog('set')}>
              Set shift for {picked.size || 'selected'} {picked.size === 1 ? 'person' : 'people'}
            </Button>
          </span>
        }
      />
      <AttendanceTabs session={session} active="/attendance/roster" />
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="flex flex-wrap items-end gap-3">
        <Button variant="outline" onClick={() => setFrom(shiftDate(from, -14))}>
          Earlier
        </Button>
        <Button variant="outline" onClick={() => setFrom(mondayOf(todayIso()))}>
          This fortnight
        </Button>
        <Button variant="outline" onClick={() => setFrom(shiftDate(from, 14))}>
          Later
        </Button>
        <div className="w-60">
          <Field id="roster-search" label="Find a person">
            <Input
              id="roster-search"
              value={search}
              placeholder="Name or code"
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {roster.isPending ? (
        <Loading />
      ) : roster.isError ? (
        <Alert tone="error">{errorMessage(roster.error)}</Alert>
      ) : roster.data.employees.length === 0 ? (
        <EmptyState title="No one to show">Change the search, or add people first.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full border-collapse text-left text-[13px]" aria-label="Roster">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 border-b border-border bg-[#f7f9fa] px-3 py-2 text-xs font-semibold text-muted-foreground">
                  Person
                </th>
                {roster.data.dates.map((d) => {
                  const l = dayLabel(d);
                  return (
                    <th
                      key={d}
                      scope="col"
                      className={cn(
                        'border-b border-border bg-[#f7f9fa] px-2 py-2 text-center text-xs font-semibold text-muted-foreground',
                        d === todayIso() && 'text-primary',
                      )}
                    >
                      {l.weekday}
                      <br />
                      {l.day}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {roster.data.employees.map((e) => (
                <tr key={e.id}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-muted bg-card px-3 py-2 text-left font-medium whitespace-nowrap"
                  >
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={picked.has(e.id)}
                        onChange={() => toggle(e.id)}
                        aria-label={`Select ${e.name}`}
                      />
                      <span>
                        {e.name}
                        <span className="block text-xs font-normal text-muted-foreground">
                          {e.employeeCode}
                        </span>
                      </span>
                    </label>
                  </th>
                  {e.days.map((day) => (
                    <td
                      key={day.date}
                      className={cn(
                        'border-b border-muted px-2 py-2 text-center',
                        day.rostered && 'bg-[#e8f1fb] font-semibold',
                        !day.shiftCode && 'text-muted-foreground',
                      )}
                      title={day.rostered ? 'Rostered' : 'Usual shift'}
                    >
                      {day.shiftCode ?? 'Off'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Shaded dates are rostered; the rest follow each person’s usual shift and weekly offs.
      </p>

      {dialog && roster.data && (
        <RosterDialog
          mode={dialog}
          shifts={roster.data.shifts}
          people={[...picked]}
          from={from}
          to={to}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setPicked(new Set());
            setNotice(text);
          }}
        />
      )}
    </>
  );
}

function RosterDialog({
  mode,
  shifts,
  people,
  from,
  to,
  onClose,
  onDone,
}: {
  mode: 'set' | 'clear';
  shifts: RosterView['shifts'];
  people: string[];
  from: string;
  to: string;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const client = useQueryClient();
  const [shiftId, setShiftId] = useState<string>(shifts[0]?.id ?? 'OFF');
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const [days, setDays] = useState<number[]>([]);
  const [error, setError] = useState<string>();
  const save = useMutation({
    mutationFn: (): Promise<{ people: number; days: number } | { removed: number }> =>
      mode === 'set'
        ? apiFetch<{ people: number; days: number }>('/v1/attendance/roster', {
            method: 'PUT',
            body: {
              employeeIds: people,
              from: start,
              to: end,
              ...(days.length ? { weekdays: days } : {}),
              shiftId: shiftId === 'OFF' ? null : shiftId,
            },
          })
        : apiFetch<{ removed: number }>('/v1/attendance/roster/clear', {
            method: 'POST',
            body: { employeeIds: people, from: start, to: end },
          }),
    onSuccess: async (r) => {
      await client.invalidateQueries({ queryKey: ['attendance'] });
      onDone(
        'removed' in r
          ? `Went back to the usual shift on ${r.removed} date${r.removed === 1 ? '' : 's'}.`
          : `Rostered ${r.people} ${r.people === 1 ? 'person' : 'people'} for ${r.days} date${r.days === 1 ? '' : 's'}.`,
      );
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={mode === 'set' ? 'Set shift' : 'Go back to the usual shift'}
      description={`For ${people.length} ${people.length === 1 ? 'person' : 'people'}.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {mode === 'set' ? 'Save roster' : 'Clear roster'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alert tone="error">{error}</Alert>}
        {mode === 'set' && (
          <Field id="ro-shift" label="Shift">
            <Select id="ro-shift" value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
              <option value="OFF">Day off</option>
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field id="ro-from" label="From">
            <Input id="ro-from" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field id="ro-to" label="To">
            <Input id="ro-to" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        {mode === 'set' && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-[13px] font-medium">Only on these days (all days if none chosen)</legend>
            <div className="flex flex-wrap gap-3">
              {WEEKDAYS.map((name, i) => (
                <label key={name} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={days.includes(i)}
                    onChange={() => setDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i]))}
                  />
                  {name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>
    </Dialog>
  );
}
