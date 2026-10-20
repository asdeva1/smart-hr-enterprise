'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { PersonPicker, ValueInput } from '@/components/operations/parts';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import { hasFeature } from '@/lib/permissions';
import {
  opsKeys,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  type ItemDetail,
  type ItemEvent,
  type Values,
} from '@/lib/operations';

export default function ItemPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="Operations" session={session}>
          <ItemView id={id} session={session} />
        </AppShell>
      )}
    </RequireSession>
  );
}

function describe(e: ItemEvent): string {
  switch (e.kind) {
    case 'CREATED':
      return 'raised this';
    case 'EDITED':
      return 'changed the details';
    case 'STAGE':
      return `moved it from ${e.data?.from ?? '?'} to ${e.data?.to ?? '?'}`;
    case 'ASSIGNED':
      return e.data?.to ? `assigned it to ${e.data.to}` : 'took the assignment off';
    case 'COMMENT':
      return 'commented';
  }
}

function ItemView({ id, session }: { id: string; session: SessionView }) {
  const client = useQueryClient();
  const [comment, setComment] = useState('');
  const [stageNote, setStageNote] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [values, setValues] = useState<Values | null>(null);
  const item = useQuery({
    queryKey: opsKeys.item(id),
    queryFn: () => apiFetch<ItemDetail>(`/v1/operations/items/${id}`),
  });
  const refresh = () => client.invalidateQueries({ queryKey: opsKeys.all });
  const move = useMutation({
    mutationFn: (stageId: string) =>
      apiFetch(`/v1/operations/items/${id}/stage`, { method: 'POST', body: { stageId, comment: stageNote } }),
    onSuccess: async () => {
      setStageNote('');
      await refresh();
    },
  });
  const post = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/operations/items/${id}/comments`, { method: 'POST', body: { body: comment } }),
    onSuccess: async () => {
      setComment('');
      await refresh();
    },
  });
  const assign = useMutation({
    mutationFn: () => apiFetch(`/v1/operations/items/${id}`, { method: 'PATCH', body: { assigneeId } }),
    onSuccess: async () => {
      setAssigning(false);
      await refresh();
    },
  });
  const summarise = useMutation({
    mutationFn: () =>
      apiFetch<{ summary: string }>(`/v1/ai/summaries/operations-items/${id}`, { method: 'POST' }),
  });
  const saveValues = useMutation({
    mutationFn: () => apiFetch(`/v1/operations/items/${id}`, { method: 'PATCH', body: { values } }),
    onSuccess: async () => {
      setValues(null);
      await refresh();
    },
  });
  if (item.isPending) return <Loading />;
  if (item.isError) return <Alert tone="error">{errorMessage(item.error)}</Alert>;
  const i = item.data;
  const shown = values ?? i.values;
  return (
    <>
      <PageHeader title={`${i.ref} · ${i.title}`} description={i.workspace.name} />
      <p className="text-sm">
        <Link className="underline" href={`/operations/${i.workspaceId}`}>
          Back to {i.workspace.name}
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="neutral">{i.stage.label}</Badge>
        <Badge tone={PRIORITY_TONE[i.priority]}>{PRIORITY_LABEL[i.priority]}</Badge>
        {i.overdue && <Badge tone="danger">Overdue</Badge>}
        <span>Assigned to {i.assignee?.name ?? 'nobody'}</span>
        <span>Due {i.dueDate ?? '—'}</span>
      </div>
      {i.description && <p className="whitespace-pre-wrap text-sm">{i.description}</p>}
      {hasFeature(session, 'ai.assistant') && (
        <section className="flex flex-col gap-2 rounded-lg border p-4 text-sm">
          <div>
            <Button variant="outline" disabled={summarise.isPending} onClick={() => summarise.mutate()}>
              {summarise.isPending ? 'Summarising…' : 'Summarise with AI'}
            </Button>
          </div>
          {summarise.isError && <Alert tone="error">{errorMessage(summarise.error)}</Alert>}
          {summarise.data && (
            <>
              <p className="whitespace-pre-wrap">{summarise.data.summary}</p>
              <p className="text-xs text-muted-foreground">
                Written by AI from this item’s history. Check it against the history below.
              </p>
            </>
          )}
        </section>
      )}
      {(move.isError || post.isError || assign.isError || saveValues.isError) && (
        <Alert tone="error">
          {errorMessage(move.error ?? post.error ?? assign.error ?? saveValues.error)}
        </Alert>
      )}
      {i.canWork && (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="font-semibold">Move it on</h2>
          <div className="flex flex-wrap items-end gap-2">
            <Field id="stage" label="New stage">
              <Select
                id="stage"
                value=""
                disabled={move.isPending}
                onChange={(e) => e.target.value && move.mutate(e.target.value)}
              >
                <option value="">Choose…</option>
                {i.stages
                  .filter((s) => s.id !== i.stage.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field id="stage-note" label="Note" hint="Optional; choose the stage after writing it">
              <Input id="stage-note" value={stageNote} onChange={(e) => setStageNote(e.target.value)} />
            </Field>
          </div>
          {i.canAssign && (
            <div className="flex flex-col gap-2">
              {assigning ? (
                <>
                  <PersonPicker value={assigneeId} currentName={i.assignee?.name} onChange={setAssigneeId} />
                  <div className="flex gap-2">
                    <Button disabled={assign.isPending} onClick={() => assign.mutate()}>
                      Save assignment
                    </Button>
                    <Button variant="outline" onClick={() => setAssigning(false)}>
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <div>
                  <Button variant="outline" onClick={() => setAssigning(true)}>
                    Change who it’s assigned to
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
      {i.fields.length > 0 && (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="font-semibold">Details</h2>
          {i.canWork ? (
            <>
              {i.fields.map((f) => (
                <ValueInput
                  key={f.key}
                  field={f}
                  value={shown[f.key]}
                  onChange={(v) => setValues({ ...shown, [f.key]: v })}
                />
              ))}
              {values && (
                <div>
                  <Button disabled={saveValues.isPending} onClick={() => saveValues.mutate()}>
                    Save details
                  </Button>
                </div>
              )}
            </>
          ) : (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {i.fields.map((f) => (
                <div key={f.key}>
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd>{String(i.values[f.key] ?? '—')}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      )}
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">History</h2>
        <ol className="flex flex-col gap-2 text-sm">
          {i.events.map((e) => (
            <li key={e.id} className="rounded-lg border p-3">
              <div>
                <strong>{e.actor}</strong> {describe(e)}{' '}
                <span className="text-muted-foreground">{new Date(e.at).toLocaleString()}</span>
              </div>
              {e.body && <p className="mt-1 whitespace-pre-wrap">{e.body}</p>}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-end gap-2">
          <Field id="comment" label="Add a comment">
            <Input id="comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <Button disabled={post.isPending || !comment.trim()} onClick={() => post.mutate()}>
            Post
          </Button>
        </div>
      </section>
    </>
  );
}
