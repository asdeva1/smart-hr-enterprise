'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { WorkspaceDialog } from '@/components/operations/parts';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import {
  opsKeys,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  type Item,
  type Template,
  type Workspace,
} from '@/lib/operations';
import { can, hasFeature } from '@/lib/permissions';

export default function OperationsPage() {
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="Operations" session={session}>
          {hasFeature(session, 'operations.templates') ? (
            <Operations session={session} />
          ) : (
            <Alert tone="info">Your organisation’s plan doesn’t include operations workspaces.</Alert>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}

function Operations({ session }: { session: SessionView }) {
  const router = useRouter();
  const [tab, setTab] = useState<'mine' | 'workspaces'>('mine');
  const [adding, setAdding] = useState(false);
  const templates = useQuery({
    queryKey: opsKeys.templates,
    queryFn: () => apiFetch<Template[]>('/v1/operations/templates'),
    enabled: adding,
  });
  return (
    <>
      <PageHeader
        title="Operations"
        description="Track work in workspaces shaped for how your teams actually run."
        actions={
          can(session, 'operations.manage') ? (
            <Button onClick={() => setAdding(true)}>New workspace</Button>
          ) : null
        }
      />
      <Tabs
        label="Operations"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'mine', label: 'My work' },
          { value: 'workspaces', label: 'Workspaces' },
        ]}
      />
      {tab === 'mine' ? <MyWork /> : <Workspaces />}
      {adding && templates.data && (
        <WorkspaceDialog
          templates={templates.data}
          allowBlank={hasFeature(session, 'operations.custom')}
          onClose={() => setAdding(false)}
          onSaved={(id) => router.push(`/operations/${id}`)}
        />
      )}
    </>
  );
}

function MyWork() {
  const mine = useQuery({ queryKey: opsKeys.mine, queryFn: () => apiFetch<Item[]>('/v1/operations/mine') });
  if (mine.isPending) return <Loading />;
  if (mine.isError) return <Alert tone="error">{errorMessage(mine.error)}</Alert>;
  if (mine.data.length === 0)
    return <EmptyState title="Nothing assigned to you">Open work given to you appears here.</EmptyState>;
  return (
    <Table label="My work">
      <thead>
        <tr>
          <Th>Item</Th>
          <Th>Workspace</Th>
          <Th>Stage</Th>
          <Th>Priority</Th>
          <Th>Due</Th>
        </tr>
      </thead>
      <tbody>
        {mine.data.map((i) => (
          <tr key={i.id}>
            <Td>
              <Link className="underline" href={`/operations/items/${i.id}`}>
                {i.ref} · {i.title}
              </Link>
            </Td>
            <Td>{i.workspace.name}</Td>
            <Td>{i.stage.label}</Td>
            <Td>
              <Badge tone={PRIORITY_TONE[i.priority]}>{PRIORITY_LABEL[i.priority]}</Badge>
            </Td>
            <Td>
              {i.dueDate ?? '—'} {i.overdue && <Badge tone="danger">Overdue</Badge>}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Workspaces() {
  const list = useQuery({
    queryKey: opsKeys.workspaces,
    queryFn: () => apiFetch<Workspace[]>('/v1/operations/workspaces'),
  });
  if (list.isPending) return <Loading />;
  if (list.isError) return <Alert tone="error">{errorMessage(list.error)}</Alert>;
  if (list.data.length === 0) {
    return <EmptyState title="No workspaces you can see">Ask an administrator to set one up.</EmptyState>;
  }
  return (
    <Table label="Workspaces">
      <thead>
        <tr>
          <Th>Workspace</Th>
          <Th>About</Th>
          <Th className="text-right">Open items</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {list.data.map((w) => (
          <tr key={w.id}>
            <Td>
              <Link className="underline" href={`/operations/${w.id}`}>
                {w.name}
              </Link>
            </Td>
            <Td>{w.description ?? '—'}</Td>
            <Td className="text-right tabular-nums">{w.openItems}</Td>
            <Td>
              <Badge tone={w.status === 'ACTIVE' ? 'success' : 'neutral'}>
                {w.status === 'ACTIVE' ? 'Active' : 'Archived'}
              </Badge>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
