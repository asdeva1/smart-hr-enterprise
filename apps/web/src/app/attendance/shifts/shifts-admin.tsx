'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { EmployeePicker } from '@/components/employees/employee-picker';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage, useBranches, useCompanies, useDepartments } from '@/lib/admin';
import { ApiError, apiFetch, type SessionView } from '@/lib/api';
import { attendanceKeys, hoursAndMinutes, useShifts, WEEKDAYS, type Shift } from '@/lib/attendance';
import { todayIso } from '@/lib/employees';
import { can } from '@/lib/permissions';
import { AttendanceTabs } from '../attendance-tabs';

export function ShiftsAdmin({ session }: { session: SessionView }) {
  const shifts = useShifts();
  const [editing, setEditing] = useState<Shift | 'new' | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [notice, setNotice] = useState<string>();
  const canConfigure = can(session, 'attendance.configure');
  const canAssign = can(session, 'attendance.manage');

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Working hours, grace for late arrival, half-day and full-day thresholds, and weekly offs."
        actions={
          <span className="flex flex-wrap gap-2">
            {canAssign && (
              <Button variant="outline" onClick={() => setAssigning(true)}>
                Assign shift
              </Button>
            )}
            {canConfigure && <Button onClick={() => setEditing('new')}>New shift</Button>}
          </span>
        }
      />
      <AttendanceTabs session={session} active="/attendance/shifts" />
      {notice && <Alert tone="success">{notice}</Alert>}
      {shifts.isPending ? (
        <Loading />
      ) : shifts.isError ? (
        <Alert tone="error">{errorMessage(shifts.error)}</Alert>
      ) : (
        <>
          {shifts.data.fallback && (
            <Alert tone="info">
              No default shift yet, so anyone without a shift works {shifts.data.fallback.name}. Create a
              shift and make it the default to change that.
            </Alert>
          )}
          <Table label="Shifts">
            <thead>
              <tr>
                <Th>Shift</Th>
                <Th>Hours</Th>
                <Th>Grace</Th>
                <Th>Half / full day</Th>
                <Th>Weekly off</Th>
                <Th>Employees</Th>
                <Th>Status</Th>
                {canConfigure && (
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                )}
              </tr>
            </thead>
            <tbody>
              {shifts.data.shifts.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <span className="font-medium">{s.name}</span>{' '}
                    <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
                    {s.isDefault && (
                      <span className="ml-2">
                        <Badge tone="info">Default</Badge>
                      </span>
                    )}
                  </Td>
                  <Td className="tabular-nums">
                    {s.start}–{s.end}
                    {s.endMinute <= s.startMinute && (
                      <span className="text-xs text-muted-foreground"> (overnight)</span>
                    )}
                  </Td>
                  <Td className="tabular-nums">{s.graceMinutes} min</Td>
                  <Td className="tabular-nums">
                    {hoursAndMinutes(s.halfDayMinutes)} / {hoursAndMinutes(s.fullDayMinutes)}
                  </Td>
                  <Td>{s.weeklyOffs.map((d) => WEEKDAYS[d]).join(', ') || 'None'}</Td>
                  <Td className="tabular-nums">{s.assigned ?? 0}</Td>
                  <Td>
                    <Badge tone={s.status === 'ACTIVE' ? 'success' : 'neutral'}>
                      {s.status === 'ACTIVE' ? 'In use' : 'Archived'}
                    </Badge>
                  </Td>
                  {canConfigure && (
                    <Td className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                        Edit<span className="sr-only"> {s.name}</span>
                      </Button>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
      {editing && (
        <ShiftDialog
          shift={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={(text) => {
            setNotice(text);
            setEditing(null);
          }}
        />
      )}
      {assigning && shifts.data && (
        <AssignDialog
          shifts={shifts.data.shifts.filter((s) => s.status === 'ACTIVE')}
          onClose={() => setAssigning(false)}
          onDone={(text) => {
            setNotice(text);
            setAssigning(false);
          }}
        />
      )}
    </>
  );
}

function useFieldErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.fieldErrors.length) {
      setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
    } else setFormError(errorMessage(e));
  };
  const reset = () => {
    setErrors({});
    setFormError(undefined);
  };
  return { errors, formError, onError, reset };
}

function ShiftDialog({
  shift,
  onClose,
  onDone,
}: {
  shift: Shift | null;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const client = useQueryClient();
  const { errors, formError, onError, reset } = useFieldErrors();
  const [v, setV] = useState({
    code: shift?.code ?? '',
    name: shift?.name ?? '',
    start: shift?.start ?? '09:00',
    end: shift?.end ?? '18:00',
    breakMinutes: String(shift?.breakMinutes ?? 60),
    graceMinutes: String(shift?.graceMinutes ?? 10),
    halfDayHours: String((shift?.halfDayMinutes ?? 240) / 60),
    fullDayHours: String((shift?.fullDayMinutes ?? 480) / 60),
    weeklyOffs: shift?.weeklyOffs ?? [0],
    isDefault: shift?.isDefault ?? false,
    archived: shift?.status === 'ARCHIVED',
  });
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: v.name,
        start: v.start,
        end: v.end,
        breakMinutes: Number(v.breakMinutes),
        graceMinutes: Number(v.graceMinutes),
        halfDayMinutes: Math.round(Number(v.halfDayHours) * 60),
        fullDayMinutes: Math.round(Number(v.fullDayHours) * 60),
        weeklyOffs: v.weeklyOffs,
        isDefault: v.isDefault,
      };
      return shift
        ? apiFetch(`/v1/attendance/shifts/${shift.id}`, {
            method: 'PATCH',
            body: { ...body, status: v.archived ? 'ARCHIVED' : 'ACTIVE' },
          })
        : apiFetch('/v1/attendance/shifts', { method: 'POST', body: { ...body, code: v.code } });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: attendanceKeys.shifts });
      onDone(shift ? `${v.name} saved.` : `${v.name} created.`);
    },
    onError,
  });
  const toggleDay = (d: number) =>
    set({
      weeklyOffs: v.weeklyOffs.includes(d) ? v.weeklyOffs.filter((x) => x !== d) : [...v.weeklyOffs, d],
    });

  return (
    <Dialog
      open
      onClose={onClose}
      title={shift ? `Edit ${shift.name}` : 'New shift'}
      description="An end time before the start means the shift runs past midnight."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="shift-form" disabled={save.isPending}>
            {shift ? 'Save shift' : 'Create shift'}
          </Button>
        </>
      }
    >
      <form
        id="shift-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          reset();
          save.mutate();
        }}
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <Field id="shift-code" label="Code" error={errors.code}>
            <Input
              id="shift-code"
              className="font-mono"
              disabled={!!shift}
              value={v.code}
              onChange={(e) => set({ code: e.target.value })}
            />
          </Field>
          <Field id="shift-name" label="Name" error={errors.name}>
            <Input id="shift-name" value={v.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="shift-start" label="Starts" error={errors.start}>
            <Input
              id="shift-start"
              type="time"
              value={v.start}
              onChange={(e) => set({ start: e.target.value })}
            />
          </Field>
          <Field id="shift-end" label="Ends" error={errors.end}>
            <Input id="shift-end" type="time" value={v.end} onChange={(e) => set({ end: e.target.value })} />
          </Field>
          <Field id="shift-break" label="Break (minutes)" error={errors.breakMinutes}>
            <Input
              id="shift-break"
              type="number"
              min={0}
              value={v.breakMinutes}
              onChange={(e) => set({ breakMinutes: e.target.value })}
            />
          </Field>
          <Field id="shift-grace" label="Late after (minutes)" error={errors.graceMinutes}>
            <Input
              id="shift-grace"
              type="number"
              min={0}
              value={v.graceMinutes}
              onChange={(e) => set({ graceMinutes: e.target.value })}
            />
          </Field>
          <Field id="shift-half" label="Half day needs (hours)" error={errors.halfDayMinutes}>
            <Input
              id="shift-half"
              type="number"
              min={0}
              step="0.5"
              value={v.halfDayHours}
              onChange={(e) => set({ halfDayHours: e.target.value })}
            />
          </Field>
          <Field id="shift-full" label="Full day needs (hours)" error={errors.fullDayMinutes}>
            <Input
              id="shift-full"
              type="number"
              min={0}
              step="0.5"
              value={v.fullDayHours}
              onChange={(e) => set({ fullDayHours: e.target.value })}
            />
          </Field>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[13px] font-medium">Weekly off</legend>
          <div className="flex flex-wrap gap-3">
            {WEEKDAYS.map((label, d) => (
              <label key={label} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={v.weeklyOffs.includes(d)} onChange={() => toggleDay(d)} />
                {label}
              </label>
            ))}
          </div>
          {errors.weeklyOffs && <span className="text-[13px] text-danger">{errors.weeklyOffs}</span>}
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={v.isDefault}
            onChange={(e) => set({ isDefault: e.target.checked })}
          />
          Default shift for anyone without one
        </label>
        {shift && !shift.isDefault && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={v.archived}
              onChange={(e) => set({ archived: e.target.checked })}
            />
            Archived (no longer offered)
          </label>
        )}
      </form>
    </Dialog>
  );
}

function AssignDialog({
  shifts,
  onClose,
  onDone,
}: {
  shifts: Shift[];
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const client = useQueryClient();
  const { errors, formError, onError, reset } = useFieldErrors();
  const companies = useCompanies();
  const branches = useBranches();
  const departments = useDepartments();
  const [shiftId, setShiftId] = useState(shifts[0]?.id ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [target, setTarget] = useState<'EMPLOYEE' | 'COMPANY' | 'BRANCH' | 'DEPARTMENT'>('DEPARTMENT');
  const [scopeId, setScopeId] = useState('');
  const [employee, setEmployee] = useState<{ id: string; name: string } | null>(null);
  const options =
    target === 'COMPANY' ? companies.data : target === 'BRANCH' ? branches.data : departments.data;
  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ assigned: number; recomputedDays: number }>('/v1/attendance/shift-assignments', {
        method: 'POST',
        body: {
          shiftId,
          effectiveFrom,
          ...(target === 'EMPLOYEE'
            ? { employeeIds: employee ? [employee.id] : [] }
            : { scope: { type: target, id: scopeId } }),
        },
      }),
    onSuccess: async (r) => {
      await client.invalidateQueries({ queryKey: ['attendance'] });
      onDone(
        `${r.assigned} ${r.assigned === 1 ? 'person is' : 'people are'} on the new shift from ${effectiveFrom}.` +
          (r.recomputedDays
            ? ` ${r.recomputedDays} day${r.recomputedDays === 1 ? '' : 's'} recalculated.`
            : ''),
      );
    },
    onError,
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Assign a shift"
      description="From the date you choose. Days already worked out since then are recalculated."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="assign-form" disabled={save.isPending}>
            Assign
          </Button>
        </>
      }
    >
      <form
        id="assign-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          reset();
          save.mutate();
        }}
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field id="assign-shift" label="Shift" error={errors.shiftId}>
            <Select id="assign-shift" value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.start}–{s.end})
                </option>
              ))}
            </Select>
          </Field>
          <Field id="assign-from" label="From" error={errors.effectiveFrom}>
            <Input
              id="assign-from"
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </Field>
        </div>
        <Field id="assign-target" label="Who">
          <Select
            id="assign-target"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value as typeof target);
              setScopeId('');
            }}
          >
            <option value="DEPARTMENT">Everyone in a department</option>
            <option value="BRANCH">Everyone in a branch</option>
            <option value="COMPANY">Everyone in a company</option>
            <option value="EMPLOYEE">One employee</option>
          </Select>
        </Field>
        {target === 'EMPLOYEE' ? (
          <Field id="assign-employee" label="Employee" error={errors.employeeIds}>
            <EmployeePicker
              id="assign-employee"
              value={employee}
              onChange={setEmployee}
              invalid={!!errors.employeeIds}
            />
          </Field>
        ) : (
          <Field
            id="assign-scope"
            label={target === 'COMPANY' ? 'Company' : target === 'BRANCH' ? 'Branch' : 'Department'}
            error={errors.employeeIds}
          >
            <Select id="assign-scope" value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
              <option value="">Choose…</option>
              {(options ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </form>
    </Dialog>
  );
}
