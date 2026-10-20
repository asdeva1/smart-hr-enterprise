'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field as FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { errorMessage, useCompanies } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import {
  FIELD_TYPE_LABEL,
  opsKeys,
  PRIORITY_LABEL,
  STAGE_KIND_LABEL,
  type Field,
  type FieldType,
  type Priority,
  type StageKind,
  type Template,
  type Values,
  type WorkspaceDetail,
} from '@/lib/operations';

function useSave<T>(request: () => Promise<T>, onDone: (result: T) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: opsKeys.all });
      onDone(result);
    },
  });
}

/** One answer box, shaped by the field's type. */
export function ValueInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string | number | boolean | null | undefined;
  onChange: (v: string | number | boolean | null) => void;
}) {
  const id = `v-${field.key}`;
  const label = field.required ? `${field.label} *` : field.label;
  if (field.type === 'BOOLEAN') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    );
  }
  if (field.type === 'SELECT') {
    return (
      <FormField id={id} label={label}>
        <Select
          id={id}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Choose…</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      </FormField>
    );
  }
  return (
    <FormField id={id} label={label}>
      <Input
        id={id}
        type={field.type === 'DATE' ? 'date' : 'text'}
        inputMode={field.type === 'NUMBER' ? 'decimal' : undefined}
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => {
          const v = e.target.value;
          onChange(field.type === 'NUMBER' && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v);
        }}
      />
    </FormField>
  );
}

export function PersonPicker({
  value,
  currentName,
  onChange,
}: {
  value: string;
  currentName?: string | undefined;
  onChange: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const people = useQuery({
    queryKey: ['operations', 'people', search],
    queryFn: () =>
      apiFetch<{ id: string; code: string; name: string }[]>(
        `/v1/operations/people?search=${encodeURIComponent(search)}`,
      ),
    enabled: search.trim().length >= 2,
  });
  return (
    <>
      <FormField
        id="op-person-search"
        label={currentName ? `Assigned to (now ${currentName})` : 'Assign to'}
        hint="Type at least two letters of a name or code"
      >
        <Input id="op-person-search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </FormField>
      {people.data && (
        <FormField id="op-person" label="Choose">
          <Select id="op-person" value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">Nobody</option>
            {people.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.code})
              </option>
            ))}
          </Select>
        </FormField>
      )}
    </>
  );
}

/** Raise a new item in a workspace. */
export function ItemDialog({
  workspace,
  canAssign,
  onClose,
  onSaved,
}: {
  workspace: WorkspaceDetail;
  canAssign: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [dueDate, setDueDate] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [values, setValues] = useState<Values>({});
  const save = useSave(
    () =>
      apiFetch<{ id: string }>(`/v1/operations/workspaces/${workspace.id}/items`, {
        method: 'POST',
        body: { title, description, priority, dueDate, assigneeId, values },
      }),
    (item) => {
      onSaved(item.id);
      onClose();
    },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={`New item in ${workspace.name}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || title.trim().length < 2} onClick={() => save.mutate()}>
            Create
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <FormField id="i-title" label="Title">
          <Input id="i-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </FormField>
        <FormField id="i-desc" label="Details" hint="Optional">
          <Input id="i-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="i-priority" label="Priority">
            <Select
              id="i-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField id="i-due" label="Due">
            <Input id="i-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </FormField>
        </div>
        {workspace.fields.map((f) => (
          <ValueInput
            key={f.key}
            field={f}
            value={values[f.key]}
            onChange={(v) => setValues((all) => ({ ...all, [f.key]: v }))}
          />
        ))}
        {canAssign && <PersonPicker value={assigneeId} onChange={setAssigneeId} />}
      </div>
    </Dialog>
  );
}

/** Create a workspace from a template, or blank where the plan allows. */
export function WorkspaceDialog({
  templates,
  allowBlank,
  onClose,
  onSaved,
}: {
  templates: Template[];
  allowBlank: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const companies = useCompanies();
  const [companyId, setCompanyId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [template, setTemplate] = useState(templates[0]?.key ?? '');
  const company = companyId || companies.data?.[0]?.id || '';
  const chosen = templates.find((t) => t.key === template);
  const save = useSave(
    () =>
      apiFetch<{ id: string }>('/v1/operations/workspaces', {
        method: 'POST',
        body: { companyId: company, code, name, description, template },
      }),
    (w) => {
      onSaved(w.id);
      onClose();
    },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title="New workspace"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !name || !code || !company} onClick={() => save.mutate()}>
            Create
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <FormField id="w-template" label="Start from">
          <Select id="w-template" value={template} onChange={(e) => setTemplate(e.target.value)}>
            {templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
            {allowBlank && <option value="">Blank (set up your own stages and fields)</option>}
          </Select>
        </FormField>
        {chosen && (
          <p className="text-sm text-muted-foreground">
            {chosen.description} Stages: {chosen.stages.join(', ')}.
            {chosen.fields.length > 0 && ` Questions: ${chosen.fields.join(', ')}.`}
          </p>
        )}
        <FormField id="w-company" label="Company">
          <Select id="w-company" value={company} onChange={(e) => setCompanyId(e.target.value)}>
            {(companies.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="w-code" label="Code" hint="A short unique code">
            <Input id="w-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </FormField>
          <FormField id="w-name" label="Name">
            <Input id="w-name" value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
        </div>
        <FormField id="w-desc" label="What it is for" hint="Optional">
          <Input id="w-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
      </div>
    </Dialog>
  );
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9]+/, '')
    .slice(0, 40);

/** Edit a workspace's stages and fields. Existing keys stay as they are so items keep their place. */
export function DefinitionDialog({
  workspace,
  onClose,
}: {
  workspace: WorkspaceDetail;
  onClose: () => void;
}) {
  const [stages, setStages] = useState(
    workspace.stages.map((s) => ({ key: s.key, label: s.label, kind: s.kind, existing: true })),
  );
  const [fields, setFields] = useState(
    workspace.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      options: f.options.join(', '),
      existing: true,
    })),
  );
  const save = useSave(
    () =>
      apiFetch(`/v1/operations/workspaces/${workspace.id}/definition`, {
        method: 'PUT',
        body: {
          stages: stages.map((s) => ({ key: s.key, label: s.label, kind: s.kind })),
          fields: fields.map((f) => ({
            key: f.key,
            label: f.label,
            type: f.type,
            required: f.required,
            ...(f.type === 'SELECT'
              ? {
                  options: f.options
                    .split(',')
                    .map((o) => o.trim())
                    .filter(Boolean),
                }
              : {}),
          })),
        },
      }),
    onClose,
  );
  const move = <T,>(list: T[], i: number, by: number) => {
    const next = [...list];
    const j = i + by;
    if (j < 0 || j >= next.length) return next;
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Set up ${workspace.name}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <h3 className="font-semibold">Stages</h3>
        <p className="text-sm text-muted-foreground">
          The first stage is where new items start. A stage that still has items can’t be removed.
        </p>
        {stages.map((s, i) => (
          <div key={s.key} className="flex flex-wrap items-end gap-2">
            <FormField id={`st-l-${i}`} label="Name">
              <Input
                id={`st-l-${i}`}
                value={s.label}
                onChange={(e) =>
                  setStages((all) =>
                    all.map((x, j) =>
                      j === i
                        ? { ...x, label: e.target.value, key: x.existing ? x.key : slug(e.target.value) }
                        : x,
                    ),
                  )
                }
              />
            </FormField>
            <FormField id={`st-k-${i}`} label="Means">
              <Select
                id={`st-k-${i}`}
                value={s.kind}
                onChange={(e) =>
                  setStages((all) =>
                    all.map((x, j) => (j === i ? { ...x, kind: e.target.value as StageKind } : x)),
                  )
                }
              >
                {(Object.keys(STAGE_KIND_LABEL) as StageKind[]).map((k) => (
                  <option key={k} value={k}>
                    {STAGE_KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </FormField>
            <Button variant="outline" onClick={() => setStages((all) => move(all, i, -1))}>
              Up
            </Button>
            <Button variant="outline" onClick={() => setStages((all) => move(all, i, 1))}>
              Down
            </Button>
            <Button variant="outline" onClick={() => setStages((all) => all.filter((_, j) => j !== i))}>
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button
            variant="outline"
            onClick={() =>
              setStages((all) => [
                ...all,
                { key: `stage_${all.length + 1}`, label: '', kind: 'OPEN', existing: false },
              ])
            }
          >
            Add a stage
          </Button>
        </div>
        <h3 className="font-semibold">Questions on every item</h3>
        {fields.map((f, i) => (
          <div key={f.key} className="flex flex-wrap items-end gap-2">
            <FormField id={`fd-l-${i}`} label="Question">
              <Input
                id={`fd-l-${i}`}
                value={f.label}
                onChange={(e) =>
                  setFields((all) =>
                    all.map((x, j) =>
                      j === i
                        ? { ...x, label: e.target.value, key: x.existing ? x.key : slug(e.target.value) }
                        : x,
                    ),
                  )
                }
              />
            </FormField>
            <FormField id={`fd-t-${i}`} label="Answer is">
              <Select
                id={`fd-t-${i}`}
                value={f.type}
                onChange={(e) =>
                  setFields((all) =>
                    all.map((x, j) => (j === i ? { ...x, type: e.target.value as FieldType } : x)),
                  )
                }
              >
                {(Object.keys(FIELD_TYPE_LABEL) as FieldType[]).map((t) => (
                  <option key={t} value={t}>
                    {FIELD_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </FormField>
            {f.type === 'SELECT' && (
              <FormField id={`fd-o-${i}`} label="Choices" hint="Separate with commas">
                <Input
                  id={`fd-o-${i}`}
                  value={f.options}
                  onChange={(e) =>
                    setFields((all) => all.map((x, j) => (j === i ? { ...x, options: e.target.value } : x)))
                  }
                />
              </FormField>
            )}
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={f.required}
                onChange={(e) =>
                  setFields((all) => all.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))
                }
              />
              Required
            </label>
            <Button variant="outline" onClick={() => setFields((all) => all.filter((_, j) => j !== i))}>
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button
            variant="outline"
            onClick={() =>
              setFields((all) => [
                ...all,
                {
                  key: `question_${all.length + 1}`,
                  label: '',
                  type: 'TEXT',
                  required: false,
                  options: '',
                  existing: false,
                },
              ])
            }
          >
            Add a question
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
