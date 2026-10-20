'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { ProjectDialog, TeamDialog } from '@/components/projects/dialogs';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import { can } from '@/lib/permissions';
import {
  addDays,
  number,
  PROJECT_STATUS_LABEL,
  projectKeys,
  type ProjectDetail,
  type TimeEntry,
} from '@/lib/projects';

const today = () => new Date().toISOString().slice(0, 10);

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="Projects" session={session}>
          <ProjectView id={id} session={session} />
        </AppShell>
      )}
    </RequireSession>
  );
}

function ProjectView({ id, session }: { id: string; session: SessionView }) {
  const client = useQueryClient();
  const manage = can(session, 'projects.manage');
  const [dialog, setDialog] = useState<'edit' | 'team' | null>(null);
  const [from, setFrom] = useState(() => addDays(today(), -30));
  const [to, setTo] = useState(today);
  const project = useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => apiFetch<ProjectDetail>(`/v1/projects/${id}`),
  });
  const time = useQuery({
    queryKey: projectKeys.projectTime(id, from, to),
    queryFn: () => apiFetch<TimeEntry[]>(`/v1/projects/${id}/time?from=${from}&to=${to}`),
    enabled: project.isSuccess,
  });
  const approve = useMutation({
    mutationFn: () =>
      apiFetch<{ approved: number }>('/v1/projects/time/approve', {
        method: 'POST',
        body: { projectId: id, from, to },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: projectKeys.all }),
  });
  if (project.isPending) return <Loading />;
  if (project.isError) return <Alert tone="error">{errorMessage(project.error)}</Alert>;
  const p = project.data;
  const open = (time.data ?? []).filter((e) => e.status === 'OPEN').length;
  return (
    <>
      <PageHeader
        title={`${p.code} · ${p.name}`}
        description={[p.clientName, PROJECT_STATUS_LABEL[p.status]].filter(Boolean).join(' · ')}
        actions={
          manage ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDialog('team')}>
                Team
              </Button>
              <Button onClick={() => setDialog('edit')}>Edit</Button>
            </div>
          ) : null
        }
      />
      <p className="text-sm">
        <Link className="underline" href="/projects">
          All projects
        </Link>
      </p>
      <dl className="grid gap-4 sm:grid-cols-4">
        <Stat label="Logged" value={`${number(p.loggedHours)} h`} />
        <Stat label="Approved" value={`${number(p.approvedHours)} h`} />
        <Stat
          label="Budget"
          value={p.budgetHours === null ? '—' : `${number(p.budgetHours)} h`}
          note={p.overBudget ? 'Over budget' : undefined}
        />
        <Stat label="Manager" value={p.manager?.name ?? '—'} />
      </dl>
      {p.money && (
        <dl className="grid gap-4 sm:grid-cols-3">
          <Stat label="Earned from billable time" value={number(p.money.revenue)} />
          <Stat label="Cost of the time" value={number(p.money.cost)} />
          <Stat
            label="Profit"
            value={number(p.money.profit)}
            note={p.money.profit < 0 ? 'Loss' : undefined}
          />
        </dl>
      )}
      <h2 className="text-lg font-semibold">Team</h2>
      <Table label="Team">
        <thead>
          <tr>
            <Th>Person</Th>
            <Th className="text-right">Hours</Th>
            {p.members.some((m) => m.costRate !== null) && <Th className="text-right">Cost per hour</Th>}
          </tr>
        </thead>
        <tbody>
          {p.members.map((m) => (
            <tr key={m.employeeId}>
              <Td>
                {m.name} ({m.code})
              </Td>
              <Td className="text-right tabular-nums">{number(m.hours)}</Td>
              {m.costRate !== null && <Td className="text-right tabular-nums">{number(m.costRate)}</Td>}
            </tr>
          ))}
        </tbody>
      </Table>
      <h2 className="text-lg font-semibold">Time logged</h2>
      <div className="flex flex-wrap items-end gap-2">
        <Field id="from" label="From">
          <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field id="to" label="To">
          <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Button disabled={approve.isPending || open === 0} onClick={() => approve.mutate()}>
          Approve open time ({open})
        </Button>
      </div>
      {approve.isError && <Alert tone="error">{errorMessage(approve.error)}</Alert>}
      {approve.isSuccess && <Alert tone="success">Approved {approve.data.approved} entries.</Alert>}
      {time.isPending ? (
        <Loading />
      ) : time.isError ? (
        <Alert tone="error">{errorMessage(time.error)}</Alert>
      ) : (
        <Table label="Time logged">
          <thead>
            <tr>
              <Th>Day</Th>
              <Th>Person</Th>
              <Th>What</Th>
              <Th className="text-right">Hours</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {time.data.map((e) => (
              <tr key={e.id}>
                <Td>{e.workDate}</Td>
                <Td>{e.employeeName}</Td>
                <Td>{e.note ?? '—'}</Td>
                <Td className="text-right tabular-nums">{number(e.hours)}</Td>
                <Td>
                  <Badge tone={e.status === 'APPROVED' ? 'success' : 'neutral'}>
                    {e.status === 'APPROVED' ? 'Approved' : 'Open'}
                  </Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {dialog === 'edit' && <ProjectDialog project={p} onClose={() => setDialog(null)} />}
      {dialog === 'team' && <TeamDialog project={p} onClose={() => setDialog(null)} />}
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div className="rounded-lg border p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
      {note && <dd className="text-sm text-amber-600">{note}</dd>}
    </div>
  );
}
