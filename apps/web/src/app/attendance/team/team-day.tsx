'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage, useDepartments } from '@/lib/admin';
import { ApiError, apiFetch, type SessionView } from '@/lib/api';
import {
  attendanceKeys,
  clockTime,
  DAY_LABEL,
  DAY_TONE,
  hoursAndMinutes,
  type TeamDay,
  type TeamRow,
} from '@/lib/attendance';
import { todayIso } from '@/lib/employees';
import { can } from '@/lib/permissions';
import { AttendanceTabs } from '../attendance-tabs';
import { CorrectionDialog } from '../correction-dialog';

const FILTERS = [
  { value: '', label: 'Everyone' },
  { value: 'PRESENT', label: 'Present' },
  { value: 'LATE', label: 'Late' },
  { value: 'HALF_DAY', label: 'Half day' },
  { value: 'ABSENT', label: 'Absent' },
  { value: 'NOT_IN', label: 'Not in yet' },
  { value: 'WEEKLY_OFF', label: 'Weekly off' },
];

export function TeamAttendance({ session }: { session: SessionView }) {
  const [date, setDate] = useState(todayIso());
  const [status, setStatus] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [searchText, setSearchText] = useState('');
  const search = useDeferredValue(searchText.trim());
  const departments = useDepartments();
  const [recording, setRecording] = useState<TeamRow | null>(null);
  const [correcting, setCorrecting] = useState<TeamRow | null>(null);
  const [notice, setNotice] = useState<string>();
  const canManage = can(session, 'attendance.manage');
  const params = new URLSearchParams({ date });
  if (status) params.set('status', status);
  if (departmentId) params.set('departmentId', departmentId);
  if (search) params.set('search', search);
  const team = useQuery({
    queryKey: attendanceKeys.team({ date, status, departmentId, search }),
    queryFn: () => apiFetch<TeamDay>(`/v1/attendance/team?${params.toString()}`),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const forbidden = team.error instanceof ApiError && team.error.status === 403;

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Your team for one day. Managers see the people who report to them; HR sees their part of the organisation."
      />
      <AttendanceTabs session={session} active="/attendance/team" />
      {notice && <Alert tone="success">{notice}</Alert>}
      {forbidden ? (
        <EmptyState title="No team to show">
          Nobody reports to you, and you don’t have access to attendance for any part of the organisation.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Field id="team-date" label="Day">
              <Input
                id="team-date"
                type="date"
                max={todayIso()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field id="team-status" label="Show">
              <Select id="team-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                {FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="team-department" label="Department">
              <Select
                id="team-department"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
              >
                <option value="">All</option>
                {(departments.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="team-search" label="Search">
              <Input
                id="team-search"
                type="search"
                placeholder="Name or employee number"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </Field>
          </div>
          {team.isPending ? (
            <Loading />
          ) : team.isError ? (
            <Alert tone="error">{errorMessage(team.error)}</Alert>
          ) : (
            <>
              <ul aria-label="Totals" className="flex flex-wrap gap-2 text-[13px]">
                <Count label="People" value={team.data.counts.total} />
                <Count label="Present" value={team.data.counts.present} />
                <Count label="Late" value={team.data.counts.late} />
                <Count label="Half day" value={team.data.counts.halfDay} />
                <Count label="Absent" value={team.data.counts.absent} />
                <Count label="Not in yet" value={team.data.counts.notIn} />
              </ul>
              {team.data.rows.length === 0 ? (
                <EmptyState title="Nobody matches">Try another day or filter.</EmptyState>
              ) : (
                <Table label={`Attendance on ${date}`}>
                  <thead>
                    <tr>
                      <Th>Employee</Th>
                      <Th>Status</Th>
                      <Th>In</Th>
                      <Th>Out</Th>
                      <Th>Worked</Th>
                      <Th>Late</Th>
                      <Th>Shift</Th>
                      {canManage && (
                        <Th>
                          <span className="sr-only">Actions</span>
                        </Th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {team.data.rows.map((r) => (
                      <tr key={r.employee.id}>
                        <Td>
                          <span className="font-medium">{r.employee.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {r.employee.employeeCode}
                            {r.employee.department ? ` · ${r.employee.department}` : ''}
                          </span>
                        </Td>
                        <Td>
                          {r.day.status ? (
                            <Badge tone={DAY_TONE[r.day.status]}>{DAY_LABEL[r.day.status]}</Badge>
                          ) : (
                            <span className="text-muted-foreground">Not in yet</span>
                          )}
                          {r.day.corrected && (
                            <span className="block text-xs text-muted-foreground">Corrected</span>
                          )}
                        </Td>
                        <Td className="tabular-nums">{clockTime(r.day.firstIn, r.employee.timeZone)}</Td>
                        <Td className="tabular-nums">{clockTime(r.day.lastOut, r.employee.timeZone)}</Td>
                        <Td className="tabular-nums">
                          {r.day.workedMinutes ? hoursAndMinutes(r.day.workedMinutes) : '—'}
                        </Td>
                        <Td className="tabular-nums">
                          {r.day.lateMinutes ? (
                            <span className="text-warning">{r.day.lateMinutes} min</span>
                          ) : (
                            '—'
                          )}
                        </Td>
                        <Td className="text-[13px]">{r.day.shift.code}</Td>
                        {canManage && (
                          <Td className="text-right whitespace-nowrap">
                            <Button size="sm" variant="ghost" onClick={() => setRecording(r)}>
                              Record time<span className="sr-only"> for {r.employee.name}</span>
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setCorrecting(r)}>
                              Correct<span className="sr-only"> {r.employee.name}</span>
                            </Button>
                          </Td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </>
          )}
        </>
      )}
      {recording && (
        <RecordDialog
          row={recording}
          date={date}
          onClose={() => setRecording(null)}
          onDone={() => {
            setNotice(`Recorded for ${recording.employee.name}. It’s in the audit log.`);
            setRecording(null);
          }}
        />
      )}
      {correcting && (
        <CorrectionDialog
          employee={{ id: correcting.employee.id, name: correcting.employee.name }}
          initialDate={date}
          onClose={() => setCorrecting(null)}
          onDone={() => {
            setNotice(`Correction for ${correcting.employee.name} sent for approval.`);
            setCorrecting(null);
          }}
        />
      )}
    </>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <li className="rounded-md border border-border bg-card px-3 py-1.5">
      <span className="font-semibold tabular-nums">{value}</span>{' '}
      <span className="text-muted-foreground">{label}</span>
    </li>
  );
}

/** Records a clock-in or clock-out on the employee's behalf. Times are the employee's local time. */
function RecordDialog({
  row,
  date,
  onClose,
  onDone,
}: {
  row: TeamRow;
  date: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const [values, setValues] = useState({ date, time: '', direction: 'IN', note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const save = useMutation({
    mutationFn: () =>
      apiFetch('/v1/attendance/punches', {
        method: 'POST',
        body: { employeeId: row.employee.id, ...values },
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['attendance'] });
      onDone();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.length) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      } else setFormError(errorMessage(e));
    },
  });
  const set = (patch: Partial<typeof values>) => setValues((v) => ({ ...v, ...patch }));
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Record time for ${row.employee.name}`}
      description="For when they couldn’t clock in themselves. The reason is kept with the record and in the audit log."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="record-form" disabled={save.isPending}>
            Record
          </Button>
        </>
      }
    >
      <form
        id="record-form"
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
        <div className="grid grid-cols-3 gap-3">
          <Field id="record-direction" label="What">
            <Select
              id="record-direction"
              value={values.direction}
              onChange={(e) => set({ direction: e.target.value })}
            >
              <option value="IN">Clock in</option>
              <option value="OUT">Clock out</option>
            </Select>
          </Field>
          <Field id="record-date" label="Date" error={errors.date}>
            <Input
              id="record-date"
              type="date"
              value={values.date}
              onChange={(e) => set({ date: e.target.value })}
            />
          </Field>
          <Field id="record-time" label="Time" error={errors.time}>
            <Input
              id="record-time"
              type="time"
              value={values.time}
              onChange={(e) => set({ time: e.target.value })}
            />
          </Field>
        </div>
        <Field id="record-note" label="Reason" error={errors.note}>
          <Input id="record-note" value={values.note} onChange={(e) => set({ note: e.target.value })} />
        </Field>
      </form>
    </Dialog>
  );
}
