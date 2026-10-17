'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDay, todayIso } from '@/lib/employees';
import {
  payrollKeys,
  rupees,
  STATES,
  useEmployeePay,
  usePayComponents,
  type EmployeePay,
} from '@/lib/payroll';

/** Salary history and statutory choices on an employee's record. */
export function PayPanel({ employeeId }: { employeeId: string }) {
  const pay = useEmployeePay(employeeId);
  const [revising, setRevising] = useState(false);
  const [notice, setNotice] = useState<string>();
  if (pay.isPending) return <Loading />;
  if (pay.isError) return <Alert tone="error">{errorMessage(pay.error)}</Alert>;
  const p = pay.data;
  const current = p.salaries[0];
  return (
    <section aria-label="Pay" className="flex flex-col gap-4">
      {notice && <Alert tone="success">{notice}</Alert>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          {current ? (
            <>
              <span className="text-[22px] font-semibold tabular-nums">{rupees(current.monthlyGross)}</span> a
              month · {rupees(current.annualCtc)} a year cost to company, from{' '}
              {formatDay(current.effectiveFrom)}
            </>
          ) : (
            'No salary yet.'
          )}
        </p>
        {p.can.manage && (
          <Button onClick={() => setRevising(true)}>{current ? 'Revise salary' : 'Add salary'}</Button>
        )}
      </div>
      {p.salaries.length > 0 && (
        <Table label="Salary history">
          <thead>
            <tr>
              <Th>From</Th>
              <Th>Components</Th>
              <Th className="text-right">Monthly</Th>
              <Th className="text-right">Annual CTC</Th>
            </tr>
          </thead>
          <tbody>
            {p.salaries.map((s) => (
              <tr key={s.id}>
                <Td>{formatDay(s.effectiveFrom)}</Td>
                <Td className="text-[13px]">
                  {s.lines.map((l) => `${l.name} ${rupees(l.monthly)}`).join(' · ')}
                </Td>
                <Td className="text-right tabular-nums">{rupees(s.monthlyGross)}</Td>
                <Td className="text-right tabular-nums">{rupees(s.annualCtc)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <StatutoryForm
        employeeId={employeeId}
        profile={p.profile}
        canManage={p.can.manage}
        onSaved={() => setNotice('Payroll details saved.')}
      />
      {revising && (
        <SalaryDialog
          pay={p}
          onClose={() => setRevising(false)}
          onDone={() => {
            setRevising(false);
            setNotice('Salary saved.');
          }}
        />
      )}
    </section>
  );
}

function StatutoryForm({
  employeeId,
  profile,
  canManage,
  onSaved,
}: {
  employeeId: string;
  profile: EmployeePay['profile'];
  canManage: boolean;
  onSaved: () => void;
}) {
  const client = useQueryClient();
  const [v, setV] = useState({ ...profile, ptState: profile.ptState ?? '' });
  const m = useMutation({
    mutationFn: () => apiFetch(`/v1/payroll/employees/${employeeId}/profile`, { method: 'PUT', body: v }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: payrollKeys.employee(employeeId) });
      onSaved();
    },
  });
  return (
    <form
      aria-label="Payroll details"
      className="flex max-w-xl flex-col gap-3 rounded-lg border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <h3 className="font-medium">Statutory deductions</h3>
      {m.isError && <Alert tone="error">{errorMessage(m.error)}</Alert>}
      {(
        [
          ['pfEnabled', 'Provident fund'],
          ['pfOnFullWages', 'PF on full wages above ₹15,000 (voluntary, both sides agreeing)'],
          ['esiEnabled', 'ESI when eligible'],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={!canManage}
            checked={v[key]}
            onChange={(e) => setV((x) => ({ ...x, [key]: e.target.checked }))}
          />
          {label}
        </label>
      ))}
      <Field id="pt-state" label="Professional tax state">
        <Select
          id="pt-state"
          disabled={!canManage}
          value={v.ptState}
          onChange={(e) => setV((x) => ({ ...x, ptState: e.target.value }))}
        >
          <option value="">None</option>
          {Object.entries(STATES).map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </Select>
      </Field>
      {canManage && (
        <Button type="submit" className="self-start" disabled={m.isPending}>
          Save payroll details
        </Button>
      )}
    </form>
  );
}

function SalaryDialog({
  pay,
  onClose,
  onDone,
}: {
  pay: EmployeePay;
  onClose: () => void;
  onDone: () => void;
}) {
  const components = usePayComponents();
  const client = useQueryClient();
  const current = pay.salaries[0];
  const [effectiveFrom, setEffectiveFrom] = useState(current ? todayIso() : pay.employee.dateOfJoining);
  const [annualCtc, setAnnualCtc] = useState(current ? String(current.annualCtc) : '');
  const [amounts, setAmounts] = useState<Record<string, string>>(
    Object.fromEntries((current?.lines ?? []).map((l) => [l.componentId, String(l.monthly)])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const active = (components.data ?? []).filter((c) => c.status === 'ACTIVE');
  const monthly = active
    .filter((c) => c.kind === 'EARNING')
    .reduce((s, c) => s + (Number(amounts[c.id]) || 0), 0);
  const m = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/payroll/employees/${pay.employee.id}/salaries`, {
        method: 'POST',
        body: {
          effectiveFrom,
          annualCtc: Number(annualCtc),
          lines: active
            .filter((c) => amounts[c.id] && Number(amounts[c.id]) > 0)
            .map((c) => ({ componentId: c.id, monthly: Number(amounts[c.id]) })),
        },
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: payrollKeys.employee(pay.employee.id) });
      onDone();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.length)
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      setFormError(errorMessage(e));
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={current ? `Revise ${pay.employee.name}’s salary` : `Salary for ${pay.employee.name}`}
      description="A revision starts on its date; earlier ones stay in the history."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={m.isPending} onClick={() => (setErrors({}), setFormError(undefined), m.mutate())}>
            Save salary
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <Field id="sal-from" label="Effective from" error={errors.effectiveFrom}>
          <Input
            {...fieldAria('sal-from', errors.effectiveFrom)}
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </Field>
        <Field id="sal-ctc" label="Annual CTC" error={errors.annualCtc}>
          <Input
            {...fieldAria('sal-ctc', errors.annualCtc)}
            inputMode="decimal"
            value={annualCtc}
            onChange={(e) => setAnnualCtc(e.target.value)}
          />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium">Monthly amounts</legend>
          {active.map((c) => (
            <Field
              key={c.id}
              id={`sal-${c.code}`}
              label={`${c.name}${c.kind === 'DEDUCTION' ? ' (deduction)' : ''}`}
            >
              <Input
                id={`sal-${c.code}`}
                inputMode="decimal"
                value={amounts[c.id] ?? ''}
                onChange={(e) => setAmounts((a) => ({ ...a, [c.id]: e.target.value }))}
              />
            </Field>
          ))}
          <p className="text-sm">
            Monthly gross <span className="font-semibold tabular-nums">{rupees(monthly)}</span>
          </p>
        </fieldset>
      </div>
    </Dialog>
  );
}
