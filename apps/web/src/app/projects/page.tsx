'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { ProjectDialog, TimeDialog } from '@/components/projects/dialogs';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import { can, hasFeature } from '@/lib/permissions';
import {
  addDays,
  number,
  PROJECT_STATUS_LABEL,
  projectKeys,
  weekStart,
  type MyProject,
  type ProjectRow,
  type TimeEntry,
} from '@/lib/projects';

const today = () => new Date().toISOString().slice(0, 10);

export default function ProjectsPage() {
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="Projects" session={session}>
          {hasFeature(session, 'projects') ? (
            <Projects session={session} />
          ) : (
            <Alert tone="info">Your organisation’s plan doesn’t include projects.</Alert>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}

function Projects({ session }: { session: SessionView }) {
  const router = useRouter();
  const [tab, setTab] = useState<'time' | 'projects'>('time');
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader
        title="Projects"
        description="Log the hours you work on each project, and see how projects are doing."
        actions={
          can(session, 'projects.manage') ? (
            <Button onClick={() => setAdding(true)}>New project</Button>
          ) : null
        }
      />
      <Tabs
        label="Projects"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'time', label: 'My time' },
          { value: 'projects', label: 'Projects' },
        ]}
      />
      {tab === 'time' ? <MyTime /> : <ProjectList />}
      {adding && (
        <ProjectDialog onClose={() => setAdding(false)} onSaved={(id) => router.push(`/projects/${id}`)} />
      )}
    </>
  );
}

function MyTime() {
  const client = useQueryClient();
  const [from, setFrom] = useState(() => weekStart(today()));
  const to = addDays(from, 6);
  const [dialog, setDialog] = useState<TimeEntry | 'new' | null>(null);
  const projects = useQuery({
    queryKey: projectKeys.mine,
    queryFn: () => apiFetch<MyProject[]>('/v1/projects/mine'),
  });
  const time = useQuery({
    queryKey: projectKeys.myTime(from, to),
    queryFn: () =>
      apiFetch<{ entries: TimeEntry[]; totalHours: number }>(`/v1/projects/time?from=${from}&to=${to}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/v1/projects/time/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: projectKeys.all }),
  });
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => setFrom(addDays(from, -7))}>
          Earlier
        </Button>
        <span className="text-sm">
          {from} to {to}
        </span>
        <Button variant="outline" onClick={() => setFrom(addDays(from, 7))} disabled={to >= today()}>
          Later
        </Button>
        <div className="flex-1" />
        <Button disabled={!projects.data?.length} onClick={() => setDialog('new')}>
          Log time
        </Button>
      </div>
      {projects.data && projects.data.length === 0 && (
        <Alert tone="info">You aren’t on any projects yet. Ask a project manager to add you.</Alert>
      )}
      {remove.isError && <Alert tone="error">{errorMessage(remove.error)}</Alert>}
      {time.isPending ? (
        <Loading />
      ) : time.isError ? (
        <Alert tone="error">{errorMessage(time.error)}</Alert>
      ) : (
        <Table label="My time this week">
          <thead>
            <tr>
              <Th>Day</Th>
              <Th>Project</Th>
              <Th>What</Th>
              <Th className="text-right">Hours</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const rows = time.data.entries.filter((e) => e.workDate === d);
              if (rows.length === 0) {
                return (
                  <tr key={d}>
                    <Td>{d}</Td>
                    <Td className="text-muted-foreground" colSpan={5}>
                      Nothing logged
                    </Td>
                  </tr>
                );
              }
              return rows.map((e) => (
                <tr key={e.id}>
                  <Td>{d}</Td>
                  <Td>{e.project ? `${e.project.code} · ${e.project.name}` : '—'}</Td>
                  <Td>{e.note ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{number(e.hours)}</Td>
                  <Td>
                    <Badge tone={e.status === 'APPROVED' ? 'success' : 'neutral'}>
                      {e.status === 'APPROVED' ? 'Approved' : 'Open'}
                    </Badge>
                  </Td>
                  <Td>
                    {e.status === 'OPEN' && (
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setDialog(e)}>
                          Change
                        </Button>
                        <Button
                          variant="outline"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(e.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    )}
                  </Td>
                </tr>
              ));
            })}
          </tbody>
          <tfoot>
            <tr>
              <Td colSpan={3}>
                <strong>Week total</strong>
              </Td>
              <Td className="text-right tabular-nums">
                <strong>{number(time.data.totalHours)}</strong>
              </Td>
              <Td colSpan={2} />
            </tr>
          </tfoot>
        </Table>
      )}
      {dialog && projects.data && (
        <TimeDialog
          entry={dialog === 'new' ? undefined : dialog}
          projects={projects.data}
          date={to < today() ? to : today()}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

function ProjectList() {
  const list = useQuery({
    queryKey: projectKeys.list,
    queryFn: () => apiFetch<ProjectRow[]>('/v1/projects'),
  });
  if (list.isPending) return <Loading />;
  if (list.isError) return <Alert tone="error">{errorMessage(list.error)}</Alert>;
  if (list.data.length === 0) {
    return <EmptyState title="No projects to show">Projects you manage or can see appear here.</EmptyState>;
  }
  return (
    <Table label="Projects">
      <thead>
        <tr>
          <Th>Project</Th>
          <Th>Client</Th>
          <Th>Status</Th>
          <Th className="text-right">Logged</Th>
          <Th className="text-right">Budget</Th>
        </tr>
      </thead>
      <tbody>
        {list.data.map((p) => (
          <tr key={p.id}>
            <Td>
              <Link className="underline" href={`/projects/${p.id}`}>
                {p.code} · {p.name}
              </Link>
            </Td>
            <Td>{p.clientName ?? '—'}</Td>
            <Td>
              <Badge tone={p.status === 'ACTIVE' ? 'success' : 'neutral'}>
                {PROJECT_STATUS_LABEL[p.status]}
              </Badge>
            </Td>
            <Td className="text-right tabular-nums">{number(p.loggedHours)} h</Td>
            <Td className="text-right tabular-nums">
              {p.budgetHours === null ? '—' : `${number(p.budgetHours)} h`}{' '}
              {p.overBudget && <Badge tone="warning">Over</Badge>}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
