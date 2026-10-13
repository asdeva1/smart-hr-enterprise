'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { adminKeys, errorMessage, usePermissionCatalogue, useRoles, type Role } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import { can } from '@/lib/permissions';

function RoleEditor({
  role,
  session,
  onDone,
}: {
  role: Role | null;
  session: SessionView;
  onDone: (message?: string) => void;
}) {
  const client = useQueryClient();
  const catalogue = usePermissionCatalogue();
  const readOnly = role?.isSystem ?? false;
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [error, setError] = useState<string>();
  const isOwner = session.activeTenant?.isTenantAdmin ?? false;

  const save = useMutation({
    mutationFn: () =>
      apiFetch(role ? `/v1/admin/roles/${role.id}` : '/v1/admin/roles', {
        method: role ? 'PATCH' : 'POST',
        body: { name, description, permissions: [...selected] },
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: adminKeys.roles });
      onDone(role ? 'Role updated.' : 'Role created.');
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const modules = new Map<string, { label: string; perms: NonNullable<typeof catalogue.data> }>();
  for (const p of catalogue.data ?? []) {
    const entry = modules.get(p.module) ?? { label: p.moduleLabel, perms: [] };
    entry.perms.push(p);
    modules.set(p.module, entry);
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(undefined);
        if (name.trim().length < 2) return setError('Give the role a name of at least 2 characters');
        save.mutate();
      }}
    >
      {readOnly && (
        <Alert tone="info">Built-in roles can’t be changed. Create a new role to adjust permissions.</Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      <Field id="role-name" label="Name">
        <Input
          id="role-name"
          value={name}
          disabled={readOnly}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </Field>
      <Field id="role-description" label="Description (optional)">
        <Input
          id="role-description"
          value={description}
          disabled={readOnly}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      {!isOwner && !readOnly && (
        <p className="text-[13px] text-muted-foreground">
          You can include only permissions you hold across the whole organisation.
        </p>
      )}
      {catalogue.isPending ? (
        <Loading />
      ) : (
        [...modules.entries()].map(([key, mod]) => (
          <fieldset key={key} className="rounded-md border border-border p-4">
            <legend className="px-1 text-sm font-semibold">{mod.label}</legend>
            <div className="flex flex-col gap-2.5">
              {mod.perms.map((p) => (
                <label key={p.code} className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-[18px] accent-primary"
                    disabled={readOnly}
                    checked={selected.has(p.code)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(p.code);
                      else next.delete(p.code);
                      setSelected(next);
                    }}
                  />
                  <span>
                    {p.label}
                    <span className="block font-mono text-xs text-muted-foreground">{p.code}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => onDone()}>
          {readOnly ? 'Close' : 'Cancel'}
        </Button>
        {!readOnly && (
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : role ? 'Save role' : 'Create role'}
          </Button>
        )}
      </div>
    </form>
  );
}

export function RolesAdmin({ session }: { session: SessionView }) {
  const client = useQueryClient();
  const roles = useRoles();
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const canManage = can(session, 'access.manage');

  const remove = useMutation({
    mutationFn: (role: Role) => apiFetch(`/v1/admin/roles/${role.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setNotice({ tone: 'success', text: 'Role deleted.' });
      await client.invalidateQueries({ queryKey: adminKeys.roles });
    },
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  });

  return (
    <>
      <PageHeader
        title="Roles"
        description="A role is a set of permissions. Give someone a role for the whole organisation or one part of it."
        actions={canManage && <Button onClick={() => setEditing('new')}>New role</Button>}
      />
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {roles.isPending ? (
        <Loading />
      ) : roles.isError ? (
        <Alert tone="error">{errorMessage(roles.error)}</Alert>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {roles.data.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-semibold">{r.name}</h2>
                  {r.description && (
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{r.description}</p>
                  )}
                </div>
                {r.isSystem && <Badge tone="info">Built-in</Badge>}
              </div>
              <p className="text-[13px] text-muted-foreground">
                {r.permissions.length} {r.permissions.length === 1 ? 'permission' : 'permissions'} ·{' '}
                {r.assignmentCount} {r.assignmentCount === 1 ? 'assignment' : 'assignments'}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(r)}
                  aria-label={`${r.isSystem || !canManage ? 'View' : 'Edit'} ${r.name}`}
                >
                  {r.isSystem || !canManage ? 'View' : 'Edit'}
                </Button>
                {canManage && !r.isSystem && (
                  <Button
                    variant="danger"
                    size="sm"
                    aria-label={`Delete ${r.name}`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(r)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New role' : (editing?.name ?? '')}
      >
        {editing !== null && (
          <RoleEditor
            role={editing === 'new' ? null : canManage ? editing : { ...editing, isSystem: true }}
            session={session}
            onDone={(message) => {
              setEditing(null);
              if (message) setNotice({ tone: 'success', text: message });
            }}
          />
        )}
      </Dialog>
    </>
  );
}
