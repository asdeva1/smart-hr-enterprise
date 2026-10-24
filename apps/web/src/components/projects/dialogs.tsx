'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { errorMessage, useCompanies } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import {
  PROJECT_STATUS_LABEL,
  projectKeys,
  type MyProject,
  type ProjectDetail,
  type ProjectStatus,
  type TimeEntry,
} from '@/lib/projects';

const today = () => new Date().toISOString().slice(0, 10);

function useSave(request: () => Promise<unknown>, onDone: () => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: projectKeys.all });
      onDone();
    },
  });
}

function usePeople(search: string) {
  return useQuery({
    queryKey: ['projects', 'people', search],
    queryFn: () =>
      apiFetch<{ id: string; code: string; name: string }[]>(
        `/v1/projects/people?search=${encodeURIComponent(search)}`,
      ),
    enabled: search.trim().length >= 2,
  });
}

/** Log time, or change an open entry. */
export function TimeDialog({
  entry,
  projects,
  date,
  onClose,
}: {
  entry?: TimeEntry | undefined;
  projects: MyProject[];
  date: string;
  onClose: () => void;
}) {
  const [projectId, setProjectId] = useState(entry?.projectId ?? projects[0]?.id ?? '');
  const [on, setOn] = useState(entry?.workDate ?? date);
  const [hours, setHours] = useState(entry ? String(entry.hours) : '');
  const [billable, setBillable] = useState(entry?.billable ?? true);
  const [note, setNote] = useState(entry?.note ?? '');
  const save = useSave(
    () =>
      entry
        ? apiFetch(`/v1/projects/time/${entry.id}`, {
            method: 'PATCH',
            body: { hours: Number(hours), billable, note },
          })
        : apiFetch('/v1/projects/time', {
            method: 'POST',
            body: { projectId, workDate: on, hours: Number(hours), billable, note },
          }),
    onClose,
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={entry ? 'Change time' : 'Log time'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || !projectId || !(Number(hours) > 0)}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <Field id="t-project" label="Project">
          <Select
            id="t-project"
            value={projectId}
            disabled={!!entry}
            onChange={(e) => setProjectId(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="t-date" label="Day">
            <Input
              id="t-date"
              type="date"
              max={today()}
              value={on}
              disabled={!!entry}
              onChange={(e) => setOn(e.target.value)}
            />
          </Field>
          <Field id="t-hours" label="Hours" hint="1.5 is an hour and a half">
            <Input
              id="t-hours"
              inputMode="decimal"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </Field>
        </div>
        <Field id="t-note" label="What you did" hint="Optional">
          <Input id="t-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} />
          Billable to the client
        </label>
      </div>
    </Dialog>
  );
}

/** Create a project, or change one. */
export function ProjectDialog({
  project,
  onClose,
  onSaved,
}: {
  project?: ProjectDetail | undefined;
  onClose: () => void;
  onSaved?: ((id: string) => void) | undefined;
}) {
  const companies = useCompanies();
  const [search, setSearch] = useState('');
  const people = usePeople(search);
  const [f, setF] = useState({
    companyId: '',
    code: project?.code ?? '',
    name: project?.name ?? '',
    clientName: project?.clientName ?? '',
    status: project?.status ?? 'ACTIVE',
    billable: project?.billable ?? true,
    hourlyRate: String(project?.hourlyRate ?? 0),
    budgetHours:
      project?.budgetHours === null || project?.budgetHours === undefined ? '' : String(project.budgetHours),
    startDate: project?.startDate ?? '',
    endDate: project?.endDate ?? '',
    managerId: project?.managerId ?? '',
    notes: project?.notes ?? '',
  });
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));
  const company = f.companyId || companies.data?.[0]?.id || '';
  const save = useMutation({
    mutationFn: async () => {
      const common = {
        name: f.name,
        clientName: f.clientName,
        billable: f.billable,
        hourlyRate: Number(f.hourlyRate) || 0,
        budgetHours: f.budgetHours === '' ? null : Number(f.budgetHours),
        startDate: f.startDate,
        endDate: f.endDate,
        managerId: f.managerId,
        notes: f.notes,
      };
      return project
        ? apiFetch<{ id: string }>(`/v1/projects/${project.id}`, {
            method: 'PATCH',
            body: { ...common, status: f.status },
          })
        : apiFetch<{ id: string }>('/v1/projects', {
            method: 'POST',
            body: { ...common, companyId: company, code: f.code },
          });
    },
    onSuccess: async (saved) => {
      await client.invalidateQueries({ queryKey: projectKeys.all });
      onSaved?.(saved.id);
      onClose();
    },
  });
  const client = useQueryClient();
  return (
    <Dialog
      open
      onClose={onClose}
      title={project ? 'Edit project' : 'New project'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || !f.name || (!project && (!f.code || !company))}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {save.isError && (
          <div className="sm:col-span-2">
            <Alert tone="error">{errorMessage(save.error)}</Alert>
          </div>
        )}
        {!project && (
          <>
            {(companies.data?.length ?? 0) !== 1 && (
              <Field id="p-company" label="Company">
                <Select id="p-company" value={company} onChange={(e) => set({ companyId: e.target.value })}>
                  {(companies.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field id="p-code" label="Code" hint="A short unique code">
              <Input id="p-code" value={f.code} onChange={(e) => set({ code: e.target.value })} />
            </Field>
          </>
        )}
        <Field id="p-name" label="Name">
          <Input id="p-name" value={f.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field id="p-client" label="Client" hint="Optional">
          <Input id="p-client" value={f.clientName} onChange={(e) => set({ clientName: e.target.value })} />
        </Field>
        <Field id="p-rate" label="Billing rate per hour">
          <Input
            id="p-rate"
            inputMode="decimal"
            value={f.hourlyRate}
            onChange={(e) => set({ hourlyRate: e.target.value })}
          />
        </Field>
        <Field id="p-budget" label="Budget in hours" hint="Optional">
          <Input
            id="p-budget"
            inputMode="decimal"
            value={f.budgetHours}
            onChange={(e) => set({ budgetHours: e.target.value })}
          />
        </Field>
        <Field id="p-start" label="Starts">
          <Input
            id="p-start"
            type="date"
            value={f.startDate}
            onChange={(e) => set({ startDate: e.target.value })}
          />
        </Field>
        <Field id="p-end" label="Ends">
          <Input
            id="p-end"
            type="date"
            value={f.endDate}
            onChange={(e) => set({ endDate: e.target.value })}
          />
        </Field>
        {project && (
          <Field id="p-status" label="Status">
            <Select
              id="p-status"
              value={f.status}
              onChange={(e) => set({ status: e.target.value as ProjectStatus })}
            >
              {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field
          id="p-mgr-search"
          label={project?.manager ? `Project manager (now ${project.manager.name})` : 'Project manager'}
          hint="Type two letters to search; they approve the team’s time"
        >
          <Input id="p-mgr-search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        {people.data && (
          <Field id="p-mgr" label="Choose">
            <Select id="p-mgr" value={f.managerId} onChange={(e) => set({ managerId: e.target.value })}>
              <option value="">No change / none</option>
              {people.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </Select>
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={f.billable} onChange={(e) => set({ billable: e.target.checked })} />
          Billable to the client
        </label>
        <div className="sm:col-span-2">
          <Field id="p-notes" label="Notes">
            <Input id="p-notes" value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

/** Choose who works on a project and what an hour of each person costs. */
export function TeamDialog({ project, onClose }: { project: ProjectDetail; onClose: () => void }) {
  const [rows, setRows] = useState(
    project.members.map((m) => ({
      employeeId: m.employeeId,
      name: m.name,
      locked: m.hours > 0,
      costRate: String(m.costRate ?? 0),
    })),
  );
  const [search, setSearch] = useState('');
  const people = usePeople(search);
  const save = useSave(
    () =>
      apiFetch(`/v1/projects/${project.id}/members`, {
        method: 'PUT',
        body: { members: rows.map((r) => ({ employeeId: r.employeeId, costRate: Number(r.costRate) || 0 })) },
      }),
    onClose,
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Project team"
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
        {rows.length === 0 && <p className="text-sm text-muted-foreground">Nobody yet.</p>}
        {rows.map((r, i) => (
          <div key={r.employeeId} className="flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1 text-sm">{r.name}</div>
            <Field id={`cost-${r.employeeId}`} label="Cost per hour">
              <Input
                id={`cost-${r.employeeId}`}
                inputMode="decimal"
                value={r.costRate}
                onChange={(e) =>
                  setRows((all) => all.map((x, j) => (j === i ? { ...x, costRate: e.target.value } : x)))
                }
              />
            </Field>
            <Button
              variant="outline"
              disabled={r.locked}
              title={r.locked ? 'They have logged time' : undefined}
              onClick={() => setRows((all) => all.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
        ))}
        <Field id="team-search" label="Add someone" hint="Type at least two letters of their name or code">
          <Input id="team-search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        {people.data && (
          <ul className="flex flex-col gap-1 text-sm">
            {people.data
              .filter((p) => !rows.some((r) => r.employeeId === p.id))
              .map((p) => (
                <li key={p.id}>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setRows((all) => [
                        ...all,
                        { employeeId: p.id, name: p.name, locked: false, costRate: '0' },
                      ])
                    }
                  >
                    Add {p.name} ({p.code})
                  </Button>
                </li>
              ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
