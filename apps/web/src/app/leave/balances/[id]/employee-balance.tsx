'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDay } from '@/lib/employees';
import { days, leaveKeys, LEDGER_LABEL, type Balance, type LedgerEntry } from '@/lib/leave';
import { ApplyDialog } from '../../apply-dialog';

interface EmployeeBalances {
  employee: { id: string; name: string; employeeCode: string };
  balances: Balance[];
  ledger: LedgerEntry[];
  canAdjust: boolean;
}

export function EmployeeBalance({ id, year }: { id: string; year: number }) {
  const router = useRouter();
  const data = useQuery({
    queryKey: leaveKeys.employee(id, year),
    queryFn: () => apiFetch<EmployeeBalances>(`/v1/leave/employees/${id}/balances?year=${year}`),
  });
  const [adjusting, setAdjusting] = useState(false);
  const [applying, setApplying] = useState(false);
  if (data.isPending) return <Loading />;
  if (data.isError) return <Alert tone="error">{errorMessage(data.error)}</Alert>;
  const { employee, balances, ledger, canAdjust } = data.data;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[13px]">
        <Link href="/leave/balances" className="text-primary hover:underline">
          Balances
        </Link>{' '}
        <span className="text-muted-foreground">/ {employee.name}</span>
      </nav>
      <PageHeader
        title={employee.name}
        description={`${employee.employeeCode} · leave in ${year}`}
        actions={
          canAdjust ? (
            <>
              <Button variant="outline" onClick={() => setAdjusting(true)}>
                Adjust balance
              </Button>
              <Button onClick={() => setApplying(true)}>Apply on their behalf</Button>
            </>
          ) : null
        }
      />
      <Table label="Balances">
        <thead>
          <tr>
            <Th>Leave type</Th>
            <Th className="text-right">Credited</Th>
            <Th className="text-right">Carried forward</Th>
            <Th className="text-right">Adjusted</Th>
            <Th className="text-right">Taken</Th>
            <Th className="text-right">Balance</Th>
            <Th className="text-right">Waiting</Th>
            <Th className="text-right">Available</Th>
          </tr>
        </thead>
        <tbody>
          {balances.map((b) => (
            <tr key={b.leaveType.id}>
              <Td className="font-medium">{b.leaveType.name}</Td>
              <Td className="text-right tabular-nums">{b.credited}</Td>
              <Td className="text-right tabular-nums">{b.carriedForward}</Td>
              <Td className="text-right tabular-nums">{b.adjusted}</Td>
              <Td className="text-right tabular-nums">{b.taken}</Td>
              <Td className="text-right tabular-nums">{b.balance}</Td>
              <Td className="text-right tabular-nums">{b.pending}</Td>
              <Td className="text-right font-semibold tabular-nums">{b.available}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <section aria-labelledby="ledger-heading" className="flex flex-col gap-3">
        <h2 id="ledger-heading" className="text-[17px] font-semibold">
          Every change in {year}
        </h2>
        {ledger.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nothing yet.</p>
        ) : (
          <Table label="Balance changes">
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Leave type</Th>
                <Th>What</Th>
                <Th className="text-right">Days</Th>
                <Th>Note</Th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((l) => (
                <tr key={l.id}>
                  <Td>{formatDay(l.createdAt.slice(0, 10))}</Td>
                  <Td>{l.leaveType}</Td>
                  <Td>
                    {l.requestId ? (
                      <Link href={`/leave/requests/${l.requestId}`} className="text-primary hover:underline">
                        {LEDGER_LABEL[l.kind]}
                      </Link>
                    ) : (
                      LEDGER_LABEL[l.kind]
                    )}
                  </Td>
                  <Td className={`text-right tabular-nums ${l.days < 0 ? 'text-danger' : ''}`}>
                    {l.days > 0 ? `+${l.days}` : l.days}
                  </Td>
                  <Td>{l.note ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
      {adjusting && (
        <AdjustDialog
          employee={employee}
          year={year}
          balances={balances}
          onClose={() => setAdjusting(false)}
          onDone={() => setAdjusting(false)}
        />
      )}
      {applying && (
        <ApplyDialog
          employee={employee}
          onClose={() => setApplying(false)}
          onDone={(r) => router.push(`/leave/requests/${r.id}`)}
        />
      )}
    </>
  );
}

function AdjustDialog({
  employee,
  year,
  balances,
  onClose,
  onDone,
}: {
  employee: { id: string; name: string };
  year: number;
  balances: Balance[];
  onClose: () => void;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const [values, setValues] = useState({ leaveTypeId: balances[0]?.leaveType.id ?? '', days: '', note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const set = (patch: Partial<typeof values>) => setValues((v) => ({ ...v, ...patch }));
  const save = useMutation({
    mutationFn: () =>
      apiFetch('/v1/leave/adjustments', {
        method: 'POST',
        body: {
          employeeId: employee.id,
          year,
          leaveTypeId: values.leaveTypeId,
          days: values.days,
          note: values.note,
        },
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['leave'] });
      onDone();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.length) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      } else {
        setFormError(e instanceof ApiError ? e.detail : 'Something went wrong. Please try again.');
      }
    },
  });
  const amount = Number(values.days);

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Adjust ${employee.name}’s balance`}
      description="For days earned or owed outside the normal rules, such as working on a holiday. Every adjustment is recorded with its reason."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="adjust-form" disabled={save.isPending}>
            Save adjustment
          </Button>
        </>
      }
    >
      <form
        id="adjust-form"
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
        <Field id="adjust-type" label="Leave type" error={errors.leaveTypeId}>
          <Select
            id="adjust-type"
            value={values.leaveTypeId}
            onChange={(e) => set({ leaveTypeId: e.target.value })}
          >
            {balances.map((b) => (
              <option key={b.leaveType.id} value={b.leaveType.id}>
                {b.leaveType.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="adjust-days"
          label="Days"
          error={errors.days}
          hint="Positive adds days, negative takes them away. Half days allowed."
        >
          <Input
            id="adjust-days"
            inputMode="decimal"
            value={values.days}
            onChange={(e) => set({ days: e.target.value })}
            aria-invalid={errors.days ? true : undefined}
          />
        </Field>
        <Field id="adjust-note" label="Reason" error={errors.note}>
          <Input
            id="adjust-note"
            value={values.note}
            onChange={(e) => set({ note: e.target.value })}
            aria-invalid={errors.note ? true : undefined}
          />
        </Field>
        {Number.isFinite(amount) && amount !== 0 && (
          <p className="text-[13px] text-muted-foreground">
            {amount > 0 ? `Adds ${days(amount)}.` : `Takes away ${days(-amount)}.`}
          </p>
        )}
      </form>
    </Dialog>
  );
}
