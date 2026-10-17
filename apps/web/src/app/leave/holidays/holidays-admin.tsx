'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage, useBranches, useCompanies } from '@/lib/admin';
import { ApiError, apiFetch, type SessionView } from '@/lib/api';
import { formatDay, todayIso } from '@/lib/employees';
import { hasFeature } from '@/lib/permissions';
import { leaveKeys, type Holiday, type HolidayCalendar } from '@/lib/leave';
import { cn } from '@/lib/utils';
import { LeaveTabs } from '../leave-tabs';

export function HolidaysAdmin({ session }: { session: SessionView }) {
  const calendars = useQuery({
    queryKey: leaveKeys.calendars,
    queryFn: () => apiFetch<HolidayCalendar[]>('/v1/holidays/calendars'),
  });
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const thisYear = Number(todayIso().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const current = calendars.data?.find((c) => c.id === selected) ?? calendars.data?.[0];

  return (
    <>
      <PageHeader
        title={hasFeature(session, 'leave.basic') ? 'Leave' : 'Holidays'}
        description="Public holidays for the whole organisation, a company or a branch. People follow the most specific calendar for where they work."
        actions={<Button onClick={() => setCreating(true)}>New calendar</Button>}
      />
      {hasFeature(session, 'leave.basic') && <LeaveTabs session={session} active="/leave/holidays" />}
      {calendars.isPending ? (
        <Loading />
      ) : calendars.isError ? (
        <Alert tone="error">{errorMessage(calendars.error)}</Alert>
      ) : calendars.data.length === 0 ? (
        <EmptyState title="No holiday calendars yet">
          Start with one for the whole organisation, then add calendars for companies or branches whose
          holidays differ.
        </EmptyState>
      ) : (
        <div className="flex flex-wrap gap-6">
          <nav aria-label="Calendars" className="flex min-w-0 flex-[1_1_220px] flex-col gap-1 self-start">
            {calendars.data.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-current={c.id === current?.id ? 'true' : undefined}
                onClick={() => setSelected(c.id)}
                className={cn(
                  'flex flex-col items-start rounded-md border px-3 py-2 text-left',
                  c.id === current?.id
                    ? 'border-primary bg-primary-soft'
                    : 'border-border bg-card hover:border-input',
                )}
              >
                <span className="font-medium">
                  {c.name}
                  {c.status === 'ARCHIVED' && <span className="text-muted-foreground"> · archived</span>}
                </span>
                <span className="text-xs text-muted-foreground">{c.placeName}</span>
              </button>
            ))}
          </nav>
          {current && (
            <CalendarHolidays
              key={current.id}
              calendar={current}
              year={year}
              years={[thisYear - 1, thisYear, thisYear + 1]}
              onYear={setYear}
            />
          )}
        </div>
      )}
      {creating && (
        <NewCalendarDialog
          calendars={calendars.data ?? []}
          year={year}
          onClose={() => setCreating(false)}
          onDone={(c) => {
            setCreating(false);
            setSelected(c.id);
          }}
        />
      )}
    </>
  );
}

function CalendarHolidays({
  calendar,
  year,
  years,
  onYear,
}: {
  calendar: HolidayCalendar;
  year: number;
  years: number[];
  onYear: (y: number) => void;
}) {
  const client = useQueryClient();
  const holidays = useQuery({
    queryKey: leaveKeys.holidays(calendar.id, year),
    queryFn: () => apiFetch<Holiday[]>(`/v1/holidays/calendars/${calendar.id}/holidays?year=${year}`),
  });
  const [values, setValues] = useState({ date: '', name: '', optional: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['holidays'] });
    await client.invalidateQueries({ queryKey: ['attendance'] });
  };
  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.fieldErrors.length) {
      setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
    } else setNotice({ tone: 'error', text: errorMessage(e) });
  };
  const add = useMutation({
    mutationFn: () =>
      apiFetch<Holiday>(`/v1/holidays/calendars/${calendar.id}/holidays`, { method: 'POST', body: values }),
    onSuccess: async (h) => {
      setValues({ date: '', name: '', optional: false });
      setNotice({ tone: 'success', text: `${h.name} added on ${formatDay(h.date)}.` });
      await refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (h: Holiday) => apiFetch(`/v1/holidays/${h.id}`, { method: 'DELETE' }),
    onSuccess: async (_r, h) => {
      setNotice({ tone: 'success', text: `${h.name} removed.` });
      await refresh();
    },
    onError,
  });
  const archive = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/holidays/calendars/${calendar.id}`, {
        method: 'PATCH',
        body: { status: calendar.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' },
      }),
    onSuccess: refresh,
    onError,
  });

  return (
    <section aria-labelledby="calendar-heading" className="flex min-w-0 flex-[999_1_480px] flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="calendar-heading" className="text-[17px] font-semibold">
            {calendar.name}
          </h2>
          <p className="text-[13px] text-muted-foreground">
            {calendar.placeName}
            {calendar.status === 'ARCHIVED' && ' · archived: people follow a broader calendar'}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field id="holiday-year" label="Year">
            <Select id="holiday-year" value={year} onChange={(e) => onYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </Field>
          {calendar.canEdit && (
            <Button variant="outline" disabled={archive.isPending} onClick={() => archive.mutate()}>
              {calendar.status === 'ACTIVE' ? 'Archive calendar' : 'Restore calendar'}
            </Button>
          )}
        </div>
      </div>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {calendar.canEdit && (
        <form
          noValidate
          aria-label="Add a holiday"
          className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setErrors({});
            setNotice(undefined);
            add.mutate();
          }}
        >
          <Field id="holiday-date" label="Date" error={errors.date}>
            <Input
              id="holiday-date"
              type="date"
              value={values.date}
              onChange={(e) => setValues((v) => ({ ...v, date: e.target.value }))}
            />
          </Field>
          <Field id="holiday-name" label="Holiday" error={errors.name}>
            <Input
              id="holiday-name"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
            />
          </Field>
          <label className="flex h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.optional}
              onChange={(e) => setValues((v) => ({ ...v, optional: e.target.checked }))}
            />
            Optional
          </label>
          <Button type="submit" disabled={add.isPending}>
            Add holiday
          </Button>
        </form>
      )}
      {holidays.isPending ? (
        <Loading />
      ) : holidays.isError ? (
        <Alert tone="error">{errorMessage(holidays.error)}</Alert>
      ) : holidays.data.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No holidays in {year} yet.</p>
      ) : (
        <Table label={`Holidays in ${year}`}>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Holiday</Th>
              <Th>Type</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {holidays.data.map((h) => (
              <tr key={h.id}>
                <Td className="tabular-nums">{formatDay(h.date)}</Td>
                <Td className="font-medium">{h.name}</Td>
                <Td>{h.optional ? <Badge tone="neutral">Optional</Badge> : 'Holiday'}</Td>
                <Td className="text-right">
                  {calendar.canEdit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(h)}
                    >
                      Remove<span className="sr-only"> {h.name}</span>
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="text-xs text-muted-foreground">
        Optional holidays show on the calendar but are working days unless someone takes leave. Changing a
        holiday updates attendance already worked out for that date.
      </p>
    </section>
  );
}

function NewCalendarDialog({
  calendars,
  year,
  onClose,
  onDone,
}: {
  calendars: HolidayCalendar[];
  year: number;
  onClose: () => void;
  onDone: (c: HolidayCalendar) => void;
}) {
  const client = useQueryClient();
  const companies = useCompanies();
  const branches = useBranches();
  const [v, setV] = useState({
    name: '',
    type: 'TENANT' as 'TENANT' | 'COMPANY' | 'BRANCH',
    id: '',
    copyFrom: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const save = useMutation({
    mutationFn: () =>
      apiFetch<HolidayCalendar>('/v1/holidays/calendars', {
        method: 'POST',
        body: {
          name: v.name,
          place: v.type === 'TENANT' ? { type: 'TENANT' } : { type: v.type, id: v.id },
          ...(v.copyFrom ? { copyFrom: { calendarId: v.copyFrom, year } } : {}),
        },
      }),
    onSuccess: async (c) => {
      await client.invalidateQueries({ queryKey: ['holidays'] });
      await client.invalidateQueries({ queryKey: ['attendance'] });
      onDone(c);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.length) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      } else {
        setFormError(e instanceof ApiError ? e.detail : 'Something went wrong. Please try again.');
      }
    },
  });
  const options =
    v.type === 'COMPANY'
      ? (companies.data ?? []).filter((c) => c.status === 'ACTIVE')
      : (branches.data ?? []).filter((b) => b.status === 'ACTIVE');

  return (
    <Dialog
      open
      onClose={onClose}
      title="New holiday calendar"
      description="One calendar per place. A branch calendar replaces its company’s, which replaces the organisation’s."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="calendar-form" disabled={save.isPending}>
            Create calendar
          </Button>
        </>
      }
    >
      <form
        id="calendar-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setErrors({});
          setFormError(undefined);
          save.mutate();
        }}
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        <Field id="calendar-name" label="Name" error={errors.name}>
          <Input id="calendar-name" value={v.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field id="calendar-place" label="For">
          <Select
            id="calendar-place"
            value={v.type}
            onChange={(e) => set({ type: e.target.value as typeof v.type, id: '' })}
          >
            <option value="TENANT">The whole organisation</option>
            <option value="COMPANY">One company</option>
            <option value="BRANCH">One branch</option>
          </Select>
        </Field>
        {v.type !== 'TENANT' && (
          <Field
            id="calendar-scope"
            label={v.type === 'COMPANY' ? 'Company' : 'Branch'}
            error={errors['place.id'] ?? errors.place}
          >
            <Select id="calendar-scope" value={v.id} onChange={(e) => set({ id: e.target.value })}>
              <option value="">Choose…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {calendars.length > 0 && (
          <Field id="calendar-copy" label={`Copy ${year}’s holidays from (optional)`}>
            <Select id="calendar-copy" value={v.copyFrom} onChange={(e) => set({ copyFrom: e.target.value })}>
              <option value="">Start empty</option>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </form>
    </Dialog>
  );
}
