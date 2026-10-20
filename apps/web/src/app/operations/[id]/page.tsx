'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { DefinitionDialog, ItemDialog } from '@/components/operations/parts';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import { opsKeys, PRIORITY_LABEL, PRIORITY_TONE, type Item, type WorkspaceDetail } from '@/lib/operations';
import { hasFeature } from '@/lib/permissions';

export default function WorkspacePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="Operations" session={session}>
          <WorkspaceView id={id} session={session} />
        </AppShell>
      )}
    </RequireSession>
  );
}

function WorkspaceView({ id, session }: { id: string; session: SessionView }) {
  const router = useRouter();
  const [stageId, setStageId] = useState('');
  const [open, setOpen] = useState('');
  const [dialog, setDialog] = useState<'item' | 'setup' | null>(null);
  const workspace = useQuery({
    queryKey: opsKeys.workspace(id),
    queryFn: () => apiFetch<WorkspaceDetail>(`/v1/operations/workspaces/${id}`),
  });
  const items = useQuery({
    queryKey: opsKeys.items(id, stageId, open),
    queryFn: () =>
      apiFetch<Item[]>(
        `/v1/operations/workspaces/${id}/items?${new URLSearchParams({
          ...(stageId ? { stageId } : {}),
          ...(open ? { open } : {}),
        }).toString()}`,
      ),
  });
  if (workspace.isPending) return <Loading />;
  if (workspace.isError) return <Alert tone="error">{errorMessage(workspace.error)}</Alert>;
  const w = workspace.data;
  const contribute = w.level === 'contribute' || w.level === 'manage';
  return (
    <>
      <PageHeader
        title={w.name}
        description={w.description ?? undefined}
        actions={
          <div className="flex gap-2">
            {w.level === 'manage' && hasFeature(session, 'operations.custom') && (
              <Button variant="outline" onClick={() => setDialog('setup')}>
                Set up
              </Button>
            )}
            {contribute && w.status === 'ACTIVE' && (
              <Button onClick={() => setDialog('item')}>New item</Button>
            )}
          </div>
        }
      />
      <p className="text-sm">
        <Link className="underline" href="/operations">
          All workspaces
        </Link>
      </p>
      <ul className="flex flex-wrap gap-2 text-sm">
        {w.stages.map((s) => (
          <li key={s.id}>
            <Badge tone={s.kind === 'OPEN' ? 'neutral' : s.kind === 'DONE' ? 'success' : 'warning'}>
              {s.label}: {s.items ?? 0}
            </Badge>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-4">
        <Field id="f-stage" label="Stage">
          <Select id="f-stage" value={stageId} onChange={(e) => setStageId(e.target.value)}>
            <option value="">All</option>
            {w.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="f-open" label="Show">
          <Select id="f-open" value={open} onChange={(e) => setOpen(e.target.value)}>
            <option value="">Everything</option>
            <option value="true">Open work only</option>
            <option value="false">Finished or dropped</option>
          </Select>
        </Field>
      </div>
      {items.isPending ? (
        <Loading />
      ) : items.isError ? (
        <Alert tone="error">{errorMessage(items.error)}</Alert>
      ) : items.data.length === 0 ? (
        <EmptyState title="No items" />
      ) : (
        <Table label="Items">
          <thead>
            <tr>
              <Th>Item</Th>
              <Th>Stage</Th>
              <Th>Priority</Th>
              <Th>Assigned to</Th>
              <Th>Due</Th>
            </tr>
          </thead>
          <tbody>
            {items.data.map((i) => (
              <tr key={i.id}>
                <Td>
                  <Link className="underline" href={`/operations/items/${i.id}`}>
                    {i.ref} · {i.title}
                  </Link>
                </Td>
                <Td>{i.stage.label}</Td>
                <Td>
                  <Badge tone={PRIORITY_TONE[i.priority]}>{PRIORITY_LABEL[i.priority]}</Badge>
                </Td>
                <Td>{i.assignee?.name ?? '—'}</Td>
                <Td>
                  {i.dueDate ?? '—'} {i.overdue && <Badge tone="danger">Overdue</Badge>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {dialog === 'item' && (
        <ItemDialog
          workspace={w}
          canAssign={contribute}
          onClose={() => setDialog(null)}
          onSaved={(itemId) => router.push(`/operations/items/${itemId}`)}
        />
      )}
      {dialog === 'setup' && <DefinitionDialog workspace={w} onClose={() => setDialog(null)} />}
    </>
  );
}
