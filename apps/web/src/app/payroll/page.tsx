'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage, useCompanies } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { can } from '@/lib/permissions';
import {
  payrollKeys,
  rupees,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  usePayrollRuns,
  type PayrollRun,
} from '@/lib/payroll';
import { PayrollPage, PayrollTabs } from './payroll-page';

export default function PayrollRunsPage() {
  const router = useRouter();
  return (
    <PayrollPage>
      {(session) => {
        if (!can(session, 'payroll.view')) return <Redirect to="/payroll/me" />;
        return (
          <Runs
            manage={can(session, 'payroll.manage')}
            onOpen={(id) => router.push(`/payroll/runs/${id}`)}
            session={session}
          />
        );
      }}
    </PayrollPage>
  );
}

function Redirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => router.replace(to), [router, to]);
  return <Loading />;
}

function Runs({
  manage,
  onOpen,
  session,
}: {
  manage: boolean;
  onOpen: (id: string) => void;
  session: Parameters<typeof PayrollTabs>[0]['session'];
}) {
  const runs = usePayrollRuns();
  const [starting, setStarting] = useState(false);
  return (
    <>
      <PageHeader
        title="Payroll"
        description="Monthly payroll by company: calculated from salaries and attendance, approved by someone else, then paid."
        actions={manage ? <Button onClick={() => setStarting(true)}>Start payroll</Button> : null}
      />
      <PayrollTabs session={session} active="/payroll" />
      {runs.isPending ? (
        <Loading />
      ) : runs.isError ? (
        <Alert tone="error">{errorMessage(runs.error)}</Alert>
      ) : runs.data.length === 0 ? (
        <EmptyState title="No payroll yet">
          Add salaries on employee records, then start a month’s payroll.
        </EmptyState>
      ) : (
        <Table label="Payroll runs">
          <thead>
            <tr>
              <Th>Month</Th>
              <Th>Company</Th>
              <Th className="text-right">People</Th>
              <Th className="text-right">Net pay</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {runs.data.map((r) => (
              <tr key={r.id}>
                <Td>
                  <Link href={`/payroll/runs/${r.id}`} className="font-medium text-primary hover:underline">
                    {r.period}
                  </Link>
                </Td>
                <Td>{r.company.name}</Td>
                <Td className="text-right tabular-nums">{r.employeeCount}</Td>
                <Td className="text-right tabular-nums">{rupees(r.net)}</Td>
                <Td>
                  <Badge tone={RUN_STATUS_TONE[r.status]}>{RUN_STATUS_LABEL[r.status]}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {starting && <StartDialog onClose={() => setStarting(false)} onDone={(r) => onOpen(r.id)} />}
    </>
  );
}

function StartDialog({ onClose, onDone }: { onClose: () => void; onDone: (r: PayrollRun) => void }) {
  const companies = useCompanies();
  const client = useQueryClient();
  const now = new Date();
  const [companyId, setCompanyId] = useState('');
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const company = companyId || companies.data?.[0]?.id || '';
  const start = useMutation({
    mutationFn: () =>
      apiFetch<PayrollRun>('/v1/payroll/runs', {
        method: 'POST',
        body: { companyId: company, year: Number(period.slice(0, 4)), month: Number(period.slice(5, 7)) },
      }),
    onSuccess: async (r) => {
      await client.invalidateQueries({ queryKey: payrollKeys.all });
      onDone(r);
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Start payroll"
      description="Everyone in the company with a salary is calculated straight away. You can correct it before sending it for approval."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!company || start.isPending} onClick={() => start.mutate()}>
            Start and calculate
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {start.isError && <Alert tone="error">{errorMessage(start.error)}</Alert>}
        <Field id="run-company" label="Company">
          <Select id="run-company" value={company} onChange={(e) => setCompanyId(e.target.value)}>
            {(companies.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="run-month" label="Month">
          <input
            id="run-month"
            type="month"
            className="h-11 w-full rounded-md border border-input bg-card px-3"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
