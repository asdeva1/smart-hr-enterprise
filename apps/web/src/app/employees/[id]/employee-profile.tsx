'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loading } from '@/components/ui/page-header';
import { Tabs } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import {
  employeeKeys,
  formatDay,
  GENDER_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  useEmployee,
  type Employee,
} from '@/lib/employees';
import { initials } from '@/lib/utils';
import { ContactsPanel } from './contacts-panel';
import { EditDetailsDialog } from './edit-details-dialog';
import { HistoryPanel } from './history-panel';
import { LifecycleDialog, type LifecycleAction } from './lifecycle-dialog';
import { PendingChanges } from './pending-changes';
import { SensitivePanel } from './sensitive-panel';

type Tab = 'overview' | 'identity' | 'contacts' | 'history';

export function EmployeeProfile({ id, session }: { id: string; session: SessionView }) {
  const employee = useEmployee(id);
  const params = useSearchParams();
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<LifecycleAction | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | undefined>(
    params.get('created') ? { tone: 'success', text: 'Employee added.' } : undefined,
  );
  const invite = useMutation({
    mutationFn: () => apiFetch(`/v1/employees/${id}/sign-in`, { method: 'POST', body: {} }),
    onSuccess: async () => {
      setNotice({ tone: 'success', text: 'Invitation sent to their work email.' });
      await client.invalidateQueries({ queryKey: employeeKeys.one(id) });
    },
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  });

  if (employee.isPending) return <Loading />;
  if (employee.isError) return <Alert tone="error">{errorMessage(employee.error)}</Alert>;
  const e = employee.data;
  const current = e.status !== 'EXITED';
  const done = (text: string) => {
    setNotice({ tone: 'success', text });
    setEditing(false);
    setAction(null);
  };

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[13px]">
        <Link href="/employees" className="text-primary hover:underline">
          Employees
        </Link>{' '}
        <span className="text-muted-foreground">/ {e.name}</span>
      </nav>
      <header className="flex flex-wrap items-start gap-4">
        <span
          aria-hidden="true"
          className="grid size-14 shrink-0 place-items-center rounded-full bg-primary-soft text-lg font-semibold text-primary"
        >
          {initials(e.name)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{e.name}</h1>
          <p className="text-muted-foreground">
            <span className="font-mono text-[13px]">{e.employeeCode}</span>
            {e.designation && ` · ${e.designation.name}`}
            {e.department && ` · ${e.department.name}`}
          </p>
          <span className="flex flex-wrap gap-1.5">
            <Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
            {e.signIn ? (
              <Badge tone={e.signIn.status === 'ACTIVE' ? 'info' : 'neutral'}>
                {e.signIn.status === 'ACTIVE' ? 'Can sign in' : 'Sign-in suspended'}
              </Badge>
            ) : (
              <Badge>No sign-in</Badge>
            )}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {e.can.manage && current && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              Edit details
            </Button>
          )}
          {e.can.manage && e.can.invite && current && !e.signIn && (
            <Button
              variant="outline"
              disabled={invite.isPending || !e.workEmail}
              onClick={() => invite.mutate()}
            >
              Invite to sign in
            </Button>
          )}
          {e.can.lifecycle && current && <ActionMenu employee={e} onChoose={setAction} />}
        </div>
      </header>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <PendingChanges id={e.id} />
      {e.status === 'ON_NOTICE' && (
        <Alert tone="warning">
          On notice since {formatDay(e.noticeGivenOn)}. Last working day {formatDay(e.lastWorkingDay)}
          {e.exitReason ? ` (${e.exitReason.name})` : ''}.
        </Alert>
      )}
      {e.status === 'EXITED' && (
        <Alert tone="info">
          Left on {formatDay(e.exitedOn)}
          {e.exitReason ? ` (${e.exitReason.name})` : ''}. The record is kept for history and reports.
        </Alert>
      )}
      <Tabs
        label="Employee"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'overview', label: 'Overview' },
          ...(e.can.viewSensitive ? [{ value: 'identity' as const, label: 'Identity and bank' }] : []),
          { value: 'contacts', label: 'Emergency contacts' },
          { value: 'history', label: 'History' },
        ]}
      />
      {tab === 'overview' && <Overview e={e} />}
      {tab === 'identity' && <SensitivePanel employee={e} session={session} />}
      {tab === 'contacts' && <ContactsPanel employee={e} />}
      {tab === 'history' && <HistoryPanel id={e.id} />}
      {editing && (
        <EditDetailsDialog
          employee={e}
          onClose={() => setEditing(false)}
          onSaved={() => done('Details saved.')}
        />
      )}
      {action && (
        <LifecycleDialog employee={e} action={action} onClose={() => setAction(null)} onDone={done} />
      )}
    </>
  );
}

const ACTIONS: { action: LifecycleAction; label: string; when: (e: Employee) => boolean }[] = [
  { action: 'promotion', label: 'Promote or change grade', when: () => true },
  { action: 'transfer', label: 'Transfer', when: () => true },
  { action: 'change_manager', label: 'Change manager', when: () => true },
  { action: 'notice', label: 'Record notice', when: (e) => e.status === 'ACTIVE' },
  { action: 'withdraw_notice', label: 'Withdraw notice', when: (e) => e.status === 'ON_NOTICE' },
  { action: 'exit', label: 'Record exit', when: () => true },
];

function ActionMenu({ employee, onChoose }: { employee: Employee; onChoose: (a: LifecycleAction) => void }) {
  return (
    <label className="flex items-center">
      <span className="sr-only">Change employment</span>
      <select
        className="h-10 rounded-md border border-primary bg-primary px-3 text-sm font-semibold text-primary-foreground"
        value=""
        onChange={(ev) => {
          if (ev.target.value) onChoose(ev.target.value as LifecycleAction);
        }}
      >
        <option value="">Change employment…</option>
        {ACTIONS.filter((a) => a.when(employee)).map((a) => (
          <option key={a.action} value={a.action}>
            {a.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">{children ?? '—'}</dd>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  const headingId = `card-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-border bg-card p-5">
      <h2 id={headingId} className="mb-3 font-semibold">
        {title}
      </h2>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4 text-sm">{children}</dl>
    </section>
  );
}

function Overview({ e }: { e: Employee }) {
  return (
    <div className="flex flex-col gap-4">
      <Card title="Job">
        <Detail label="Company">{e.company.name}</Detail>
        <Detail label="Branch">{e.branch?.name}</Detail>
        <Detail label="Department">{e.department?.name}</Detail>
        <Detail label="Designation">{e.designation?.name}</Detail>
        <Detail label="Grade">{e.grade?.name}</Detail>
        <Detail label="Employment type">{e.employmentType?.name}</Detail>
        <Detail label="Cost centre">{e.costCentre?.name}</Detail>
        <Detail label="Manager">
          {e.manager ? (
            <Link href={`/employees/${e.manager.id}`} className="text-primary hover:underline">
              {e.manager.name}
            </Link>
          ) : null}
        </Detail>
        <Detail label="Direct reports">
          {e.directReports > 0 ? (
            <Link href={`/employees/org-chart#${e.id}`} className="text-primary hover:underline">
              {e.directReports}
            </Link>
          ) : (
            'None'
          )}
        </Detail>
      </Card>
      <Card title="Employment">
        <Detail label="Joined">{formatDay(e.dateOfJoining)}</Detail>
        <Detail label="Probation ends">{e.probationEndDate ? formatDay(e.probationEndDate) : null}</Detail>
        <Detail label="Status">{STATUS_LABEL[e.status]}</Detail>
        {e.lastWorkingDay && <Detail label="Last working day">{formatDay(e.lastWorkingDay)}</Detail>}
      </Card>
      <Card title="Personal and contact">
        <Detail label="Preferred name">{e.preferredName}</Detail>
        <Detail label="Date of birth">{e.dateOfBirth ? formatDay(e.dateOfBirth) : null}</Detail>
        <Detail label="Gender">{e.gender ? GENDER_LABEL[e.gender] : null}</Detail>
        <Detail label="Work email">{e.workEmail}</Detail>
        <Detail label="Personal email">{e.personalEmail}</Detail>
        <Detail label="Mobile">{e.phone}</Detail>
      </Card>
    </div>
  );
}
