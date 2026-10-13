'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createLookupValueSchema, type CreateLookupValueInput } from '@smart-hr/validation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { applyFieldErrors, errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { configKeys, useLookupValues, useMasterDataLists, type LookupValue } from '@/lib/configuration';

export function MasterDataAdmin() {
  const lists = useMasterDataLists();
  const [selected, setSelected] = useState<string>();

  if (lists.isPending) return <Loading />;
  if (lists.isError) return <Alert tone="error">{errorMessage(lists.error)}</Alert>;
  const current = lists.data.find((l) => l.list === selected) ?? lists.data[0]!;

  return (
    <>
      <PageHeader
        title="Reference lists"
        description="The values people choose from across Smart HR. Values are archived rather than deleted, so past records keep their meaning."
      />
      <Tabs
        label="Lists"
        value={current.list}
        onChange={setSelected}
        options={lists.data.map((l) => ({ value: l.list, label: l.label }))}
      />
      <ListPanel key={current.list} list={current} />
    </>
  );
}

function ListPanel({ list }: { list: NonNullable<ReturnType<typeof useMasterDataLists>['data']>[number] }) {
  const client = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<LookupValue | 'new'>();
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const values = useLookupValues(list.list, showArchived);

  const refresh = () => client.invalidateQueries({ queryKey: configKeys.lists });

  const setStatus = useMutation({
    mutationFn: (v: LookupValue) =>
      apiFetch<LookupValue>(`/v1/master-data/${list.list}/${v.id}`, {
        method: 'PATCH',
        body: { status: v.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' },
      }),
    onSuccess: async (v) => {
      setNotice({ tone: 'success', text: `${v.name} ${v.status === 'ARCHIVED' ? 'archived' : 'restored'}.` });
      await refresh();
    },
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  });

  const suggestions = useMutation({
    mutationFn: () =>
      apiFetch<{ added: number }>(`/v1/master-data/${list.list}/suggestions`, { method: 'POST' }),
    onSuccess: async (r) => {
      setNotice({ tone: 'success', text: `Added ${r.added} suggested value(s).` });
      await refresh();
    },
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  });

  return (
    <section aria-label={list.label} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p>{list.description}</p>
          <p className="text-[13px] text-muted-foreground">Used by: {list.usedBy}</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {list.suggestionsAvailable > 0 && (
            <Button variant="outline" disabled={suggestions.isPending} onClick={() => suggestions.mutate()}>
              Add {list.suggestionsAvailable} suggested
            </Button>
          )}
          <Button onClick={() => setEditing('new')}>Add value</Button>
        </div>
      </div>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Show archived ({list.archived})
      </label>

      {values.isPending ? (
        <Loading />
      ) : values.isError ? (
        <Alert tone="error">{errorMessage(values.error)}</Alert>
      ) : values.data.length === 0 ? (
        <EmptyState title={`No ${list.label.toLowerCase()} yet`}>
          Add the values your organisation uses
          {list.suggestionsAvailable > 0 ? ', or start from the suggestions' : ''}.
        </EmptyState>
      ) : (
        <Table label={list.label}>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Description</Th>
              <Th className="text-right">Order</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {values.data.map((v) => (
              <tr key={v.id}>
                <Td className="font-mono text-[13px]">{v.code}</Td>
                <Td className="font-medium">{v.name}</Td>
                <Td className="text-[13px] text-muted-foreground">{v.description ?? '—'}</Td>
                <Td className="text-right tabular-nums">{v.sortOrder}</Td>
                <Td>
                  <Badge tone={v.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {v.status === 'ACTIVE' ? 'Active' : 'Archived'}
                  </Badge>
                </Td>
                <Td className="text-right whitespace-nowrap">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(v)}>
                    Edit<span className="sr-only"> {v.name}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate(v)}
                  >
                    {v.status === 'ACTIVE' ? 'Archive' : 'Restore'}
                    <span className="sr-only"> {v.name}</span>
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {editing && (
        <ValueDialog
          list={list.list}
          listLabel={list.label}
          value={editing === 'new' ? null : editing}
          onClose={() => setEditing(undefined)}
          onSaved={async (text) => {
            setEditing(undefined);
            setNotice({ tone: 'success', text });
            await refresh();
          }}
        />
      )}
    </section>
  );
}

function ValueDialog({
  list,
  listLabel,
  value,
  onClose,
  onSaved,
}: {
  list: string;
  listLabel: string;
  value: LookupValue | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [error, setError] = useState<string>();
  const form = useForm<CreateLookupValueInput>({
    resolver: zodResolver(createLookupValueSchema),
    defaultValues: {
      code: value?.code ?? '',
      name: value?.name ?? '',
      description: value?.description ?? '',
      sortOrder: value?.sortOrder ?? 0,
    },
  });
  const save = useMutation({
    mutationFn: (v: CreateLookupValueInput) =>
      value
        ? apiFetch<LookupValue>(`/v1/master-data/${list}/${value.id}`, {
            method: 'PATCH',
            body: { name: v.name, description: v.description, sortOrder: v.sortOrder },
          })
        : apiFetch<LookupValue>(`/v1/master-data/${list}`, { method: 'POST', body: v }),
    onSuccess: (saved) => onSaved(value ? `${saved.name} updated.` : `${saved.name} added.`),
    onError: (e) => {
      if (!applyFieldErrors(e, form.setError)) setError(errorMessage(e));
    },
  });
  const errors = form.formState.errors;
  const formId = `value-form-${list}`;

  return (
    <Dialog
      open
      onClose={onClose}
      title={value ? `Edit ${value.name}` : `Add to ${listLabel.toLowerCase()}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={save.isPending}>
            {value ? 'Save' : 'Add value'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((v) => {
          setError(undefined);
          save.mutate(v);
        })}
      >
        {error && <Alert tone="error">{error}</Alert>}
        <Field
          id="value-code"
          label="Code"
          error={errors.code?.message}
          hint={
            value
              ? 'Codes never change. Archive and add a new value instead.'
              : 'Short and unique in this list, e.g. SDE-2'
          }
        >
          <Input
            {...fieldAria('value-code', errors.code?.message, 'hint')}
            disabled={!!value}
            className="font-mono uppercase"
            {...form.register('code')}
          />
        </Field>
        <Field id="value-name" label="Name" error={errors.name?.message}>
          <Input {...fieldAria('value-name', errors.name?.message)} {...form.register('name')} />
        </Field>
        <Field id="value-description" label="Description (optional)" error={errors.description?.message}>
          <Input
            {...fieldAria('value-description', errors.description?.message)}
            {...form.register('description')}
          />
        </Field>
        <Field
          id="value-order"
          label="Display order"
          error={errors.sortOrder?.message}
          hint="Lower numbers come first"
        >
          <Input
            type="number"
            min={0}
            max={9999}
            {...fieldAria('value-order', errors.sortOrder?.message, 'hint')}
            {...form.register('sortOrder')}
          />
        </Field>
      </form>
    </Dialog>
  );
}
