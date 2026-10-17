'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/admin';
import { ApiError, apiFetch } from '@/lib/api';
import {
  ASSIGNEE_LABEL,
  recruitmentKeys,
  useOnboardingTemplates,
  type OnboardingTemplate,
} from '@/lib/recruitment';
import { OnboardingPage, OnboardingTabs } from '../onboarding-page';

type Assignee = 'HR' | 'MANAGER' | 'EMPLOYEE';
interface TaskDraft {
  title: string;
  assignee: Assignee;
  dueOffsetDays: string;
}

export default function ChecklistsPage() {
  const templates = useOnboardingTemplates();
  const [editing, setEditing] = useState<OnboardingTemplate | 'new' | null>(null);
  const [notice, setNotice] = useState<string>();
  return (
    <OnboardingPage permission="onboarding.manage">
      {(session) => (
        <>
          <PageHeader
            title="Onboarding"
            description="Checklists for new joiners. Each task is for HR, the manager or the joiner, due days from joining."
            actions={<Button onClick={() => setEditing('new')}>Add checklist</Button>}
          />
          <OnboardingTabs session={session} active="/onboarding/templates" />
          {notice && <Alert tone="success">{notice}</Alert>}
          {templates.isPending ? (
            <Loading />
          ) : templates.isError ? (
            <Alert tone="error">{errorMessage(templates.error)}</Alert>
          ) : templates.data.length === 0 ? (
            <EmptyState title="No checklists yet" />
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {templates.data.map((t) => (
                <li key={t.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{t.name}</p>
                    <span className="flex items-center gap-2">
                      {t.status === 'ARCHIVED' && <Badge>Archived</Badge>}
                      <Button size="sm" variant="outline" onClick={() => setEditing(t)}>
                        Edit
                      </Button>
                    </span>
                  </div>
                  <ol className="list-decimal pl-5 text-[13px]">
                    {t.tasks.map((task) => (
                      <li key={task.id}>
                        {task.title}{' '}
                        <span className="text-muted-foreground">
                          · {ASSIGNEE_LABEL[task.assignee]}, day{' '}
                          {task.dueOffsetDays >= 0 ? `+${task.dueOffsetDays}` : task.dueOffsetDays}
                        </span>
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ul>
          )}
          {editing && (
            <ChecklistDialog
              template={editing === 'new' ? null : editing}
              onClose={() => setEditing(null)}
              onDone={(t) => {
                setEditing(null);
                setNotice(`“${t.name}” saved.`);
              }}
            />
          )}
        </>
      )}
    </OnboardingPage>
  );
}

function ChecklistDialog({
  template,
  onClose,
  onDone,
}: {
  template: OnboardingTemplate | null;
  onClose: () => void;
  onDone: (t: OnboardingTemplate) => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState(template?.name ?? '');
  const [archived, setArchived] = useState(template?.status === 'ARCHIVED');
  const [tasks, setTasks] = useState<TaskDraft[]>(
    template?.tasks.map((t) => ({
      title: t.title,
      assignee: t.assignee,
      dueOffsetDays: String(t.dueOffsetDays),
    })) ?? [{ title: '', assignee: 'HR', dueOffsetDays: '0' }],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const setTask = (i: number, patch: Partial<TaskDraft>) =>
    setTasks((list) => list.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        status: archived ? 'ARCHIVED' : 'ACTIVE',
        tasks: tasks.map((t) => ({
          title: t.title,
          assignee: t.assignee,
          dueOffsetDays: Number(t.dueOffsetDays || 0),
        })),
      };
      return template
        ? apiFetch<OnboardingTemplate>(`/v1/onboarding/templates/${template.id}`, { method: 'PUT', body })
        : apiFetch<OnboardingTemplate>('/v1/onboarding/templates', { method: 'POST', body });
    },
    onSuccess: async (t) => {
      await client.invalidateQueries({ queryKey: recruitmentKeys.templates });
      onDone(t);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.length) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      } else setFormError(errorMessage(e));
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={template ? `Edit “${template.name}”` : 'Add a checklist'}
      description="Onboarding already started keeps its own copy of the tasks."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="checklist-form" disabled={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="checklist-form"
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
        <Field id="cl-name" label="Name" error={errors.name}>
          <Input
            {...fieldAria('cl-name', errors.name)}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-[13px] font-medium">Tasks</legend>
          {tasks.map((t, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-2">
              <Field id={`cl-task-${i}`} label={`Task ${i + 1}`} error={errors[`tasks.${i}.title`]}>
                <Input
                  {...fieldAria(`cl-task-${i}`, errors[`tasks.${i}.title`])}
                  value={t.title}
                  onChange={(e) => setTask(i, { title: e.target.value })}
                />
              </Field>
              <Field id={`cl-who-${i}`} label="For">
                <Select
                  id={`cl-who-${i}`}
                  value={t.assignee}
                  onChange={(e) => setTask(i, { assignee: e.target.value as Assignee })}
                >
                  {(Object.keys(ASSIGNEE_LABEL) as Assignee[]).map((a) => (
                    <option key={a} value={a}>
                      {ASSIGNEE_LABEL[a]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id={`cl-day-${i}`} label="Day">
                <Input
                  id={`cl-day-${i}`}
                  type="number"
                  className="w-20"
                  value={t.dueOffsetDays}
                  onChange={(e) => setTask(i, { dueOffsetDays: e.target.value })}
                />
              </Field>
              <Button
                variant="ghost"
                aria-label={`Remove task ${i + 1}`}
                disabled={tasks.length === 1}
                onClick={() => setTasks((l) => l.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            className="self-start"
            onClick={() => setTasks((l) => [...l, { title: '', assignee: 'HR', dueOffsetDays: '0' }])}
          >
            <Plus className="size-4" /> Add task
          </Button>
          <p className="text-xs text-muted-foreground">Day 0 is the joining date; −2 is two days before.</p>
        </fieldset>
        {template && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            Archived (no longer offered)
          </label>
        )}
      </form>
    </Dialog>
  );
}
