'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { EmployeePicker } from '@/components/employees/employee-picker';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { errorMessage, useBranches, useCompanies, useDepartments } from '@/lib/admin';
import { ApiError, apiFetch } from '@/lib/api';
import { useLookupValues } from '@/lib/configuration';
import { employeeKeys, todayIso, type Employee } from '@/lib/employees';

export type LifecycleAction =
  'transfer' | 'promotion' | 'change_manager' | 'notice' | 'withdraw_notice' | 'exit';

const TITLES: Record<LifecycleAction, { title: string; description: string; submit: string; done: string }> =
  {
    promotion: {
      title: 'Promote or change grade',
      description: 'Records the new designation or grade from the date you choose.',
      submit: 'Record promotion',
      done: 'Promotion recorded.',
    },
    transfer: {
      title: 'Transfer',
      description: 'Moves them to another company, branch, department or cost centre.',
      submit: 'Record transfer',
      done: 'Transfer recorded.',
    },
    change_manager: {
      title: 'Change manager',
      description: 'Who they report to from the date you choose.',
      submit: 'Change manager',
      done: 'Manager changed.',
    },
    notice: {
      title: 'Record notice',
      description: 'They stay employed, marked as on notice, until their last working day.',
      submit: 'Record notice',
      done: 'Notice recorded.',
    },
    withdraw_notice: {
      title: 'Withdraw notice',
      description: 'They stay on as an active employee.',
      submit: 'Withdraw notice',
      done: 'Notice withdrawn.',
    },
    exit: {
      title: 'Record exit',
      description:
        'Marks them as having left. Their sign-in to this organisation is suspended. Nothing is deleted.',
      submit: 'Record exit',
      done: 'Exit recorded.',
    },
  };

function LookupChoice({
  id,
  list,
  label,
  value,
  onChange,
}: {
  id: string;
  list: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const values = useLookupValues(list);
  return (
    <Field id={id} label={label}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not set</option>
        {values.data?.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function LifecycleDialog({
  employee: e,
  action,
  onClose,
  onDone,
}: {
  employee: Employee;
  action: LifecycleAction;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const client = useQueryClient();
  const companies = useCompanies();
  const branches = useBranches();
  const departments = useDepartments();
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [v, setV] = useState({
    effectiveDate: todayIso(),
    companyId: e.companyId,
    branchId: e.branchId ?? '',
    departmentId: e.departmentId ?? '',
    costCentreId: e.costCentreId ?? '',
    designationId: e.designationId ?? '',
    gradeId: e.gradeId ?? '',
    noticeGivenOn: todayIso(),
    lastWorkingDay: '',
    exitedOn: e.lastWorkingDay ?? todayIso(),
    exitReasonId: e.exitReasonId ?? '',
    note: '',
  });
  const [manager, setManager] = useState<{ id: string; name: string } | null>(e.manager);
  const set = (patch: Partial<typeof v>) => setV((old) => ({ ...old, ...patch }));
  const text = TITLES[action];

  const body = (): Record<string, unknown> => {
    const base = { action, version: e.version, note: v.note };
    switch (action) {
      case 'transfer':
        return {
          ...base,
          effectiveDate: v.effectiveDate,
          companyId: v.companyId,
          branchId: v.branchId,
          departmentId: v.departmentId,
          costCentreId: v.costCentreId,
        };
      case 'promotion':
        return {
          ...base,
          effectiveDate: v.effectiveDate,
          designationId: v.designationId,
          gradeId: v.gradeId,
        };
      case 'change_manager':
        return { ...base, effectiveDate: v.effectiveDate, managerId: manager?.id ?? null };
      case 'notice':
        return {
          ...base,
          noticeGivenOn: v.noticeGivenOn,
          lastWorkingDay: v.lastWorkingDay,
          exitReasonId: v.exitReasonId,
        };
      case 'withdraw_notice':
        return { ...base, effectiveDate: v.effectiveDate };
      case 'exit':
        return { ...base, exitedOn: v.exitedOn, exitReasonId: v.exitReasonId };
    }
  };
  const submit = useMutation({
    mutationFn: () =>
      apiFetch<Employee & { pendingChange?: { id: string } }>(`/v1/employees/${e.id}/lifecycle`, {
        method: 'POST',
        body: body(),
      }),
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: employeeKeys.all });
      // Organisations can require approval for employment changes; then nothing changes until it's approved.
      onDone(result.pendingChange ? 'Sent for approval. It takes effect once approved.' : text.done);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fieldErrors.length > 0) {
        setFieldErrors(Object.fromEntries(err.fieldErrors.map((f) => [f.path, f.message])));
        setError(undefined);
      } else setError(errorMessage(err));
    },
  });

  const dateField = (id: keyof typeof v, label: string) => (
    <Field id={`lc-${id}`} label={label} error={fieldErrors[id]}>
      <Input
        id={`lc-${id}`}
        type="date"
        value={v[id]}
        aria-invalid={!!fieldErrors[id] || undefined}
        onChange={(ev) => set({ [id]: ev.target.value })}
      />
    </Field>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={text.title}
      description={text.description}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="lifecycle"
            variant={action === 'exit' ? 'danger' : 'primary'}
            disabled={submit.isPending}
          >
            {text.submit}
          </Button>
        </>
      }
    >
      <form
        id="lifecycle"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          setFieldErrors({});
          submit.mutate();
        }}
      >
        {error && <Alert tone="error">{error}</Alert>}
        {action === 'transfer' && (
          <>
            <Field id="lc-company" label="Company" error={fieldErrors.companyId}>
              <Select
                id="lc-company"
                value={v.companyId}
                onChange={(ev) => set({ companyId: ev.target.value, branchId: '', departmentId: '' })}
              >
                {companies.data
                  ?.filter((c) => c.status === 'ACTIVE' || c.id === e.companyId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field id="lc-branch" label="Branch" error={fieldErrors.branchId}>
              <Select id="lc-branch" value={v.branchId} onChange={(ev) => set({ branchId: ev.target.value })}>
                <option value="">Not set</option>
                {branches.data
                  ?.filter((b) => b.companyId === v.companyId && b.status === 'ACTIVE')
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field id="lc-department" label="Department" error={fieldErrors.departmentId}>
              <Select
                id="lc-department"
                value={v.departmentId}
                onChange={(ev) => set({ departmentId: ev.target.value })}
              >
                <option value="">Not set</option>
                {departments.data
                  ?.filter((d) => d.companyId === v.companyId && d.status === 'ACTIVE')
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <LookupChoice
              id="lc-costCentre"
              list="cost_centre"
              label="Cost centre"
              value={v.costCentreId}
              onChange={(x) => set({ costCentreId: x })}
            />
            {dateField('effectiveDate', 'Effective from')}
          </>
        )}
        {action === 'promotion' && (
          <>
            <LookupChoice
              id="lc-designation"
              list="designation"
              label="Designation"
              value={v.designationId}
              onChange={(x) => set({ designationId: x })}
            />
            <LookupChoice
              id="lc-grade"
              list="grade"
              label="Grade"
              value={v.gradeId}
              onChange={(x) => set({ gradeId: x })}
            />
            {dateField('effectiveDate', 'Effective from')}
          </>
        )}
        {action === 'change_manager' && (
          <>
            <Field id="lc-manager" label="New manager" error={fieldErrors.managerId}>
              <EmployeePicker id="lc-manager" value={manager} onChange={setManager} exclude={e.id} />
            </Field>
            <p className="-mt-2 text-xs text-muted-foreground">Leave empty if they won’t report to anyone.</p>
            {dateField('effectiveDate', 'Effective from')}
          </>
        )}
        {action === 'notice' && (
          <>
            {dateField('noticeGivenOn', 'Notice given on')}
            {dateField('lastWorkingDay', 'Last working day')}
            <LookupChoice
              id="lc-exitReason"
              list="exit_reason"
              label="Reason"
              value={v.exitReasonId}
              onChange={(x) => set({ exitReasonId: x })}
            />
          </>
        )}
        {action === 'withdraw_notice' && dateField('effectiveDate', 'Withdrawn on')}
        {action === 'exit' && (
          <>
            {dateField('exitedOn', 'Left on')}
            <LookupChoice
              id="lc-exitReason"
              list="exit_reason"
              label="Reason"
              value={v.exitReasonId}
              onChange={(x) => set({ exitReasonId: x })}
            />
            {fieldErrors.exitReasonId && (
              <p className="-mt-2 text-xs text-danger">{fieldErrors.exitReasonId}</p>
            )}
          </>
        )}
        <Field id="lc-note" label="Note (optional, kept in the history)">
          <Input id="lc-note" value={v.note} onChange={(ev) => set({ note: ev.target.value })} />
        </Field>
      </form>
    </Dialog>
  );
}
