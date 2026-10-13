'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ScopePicker } from '@/components/scope-picker';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Loading } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  adminKeys,
  errorMessage,
  formatDateTime,
  scopeLabel,
  useRoles,
  type Member,
  type ScopeType,
} from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import { can } from '@/lib/permissions';
import { MemberBadges } from '../people-admin';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const id = title.replace(/\W+/g, '-').toLowerCase();
  return (
    <section aria-labelledby={id} className="rounded-lg border border-border bg-card p-5">
      <h2 id={id} className="text-[15px] font-semibold">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function AddRole({ member, onAdded }: { member: Member; onAdded: () => void }) {
  const roles = useRoles();
  const [roleId, setRoleId] = useState('');
  const [scope, setScope] = useState<{ type: ScopeType; id: string }>({ type: 'TENANT', id: '' });
  const [error, setError] = useState<string>();
  const add = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/admin/members/${member.membershipId}/assignments`, {
        method: 'POST',
        body: { roleId, scopeType: scope.type, scopeId: scope.id || null },
      }),
    onSuccess: () => {
      setRoleId('');
      setScope({ type: 'TENANT', id: '' });
      onAdded();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <form
      className="mt-4 flex flex-col gap-4 border-t border-muted pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(undefined);
        if (!roleId) return setError('Choose a role');
        if (scope.type !== 'TENANT' && !scope.id) return setError('Choose where this role applies');
        add.mutate();
      }}
    >
      <h3 className="text-sm font-semibold">Add a role</h3>
      {error && <Alert tone="error">{error}</Alert>}
      <Field id="add-role" label="Role">
        <Select id="add-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          <option value="">Choose…</option>
          {roles.data?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      <ScopePicker
        idPrefix="add-role"
        scopeType={scope.type}
        scopeId={scope.id}
        onChange={(type, id) => setScope({ type, id })}
      />
      <div>
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? 'Adding…' : 'Add role'}
        </Button>
      </div>
    </form>
  );
}

export function MemberDetail({ id, session }: { id: string; session: SessionView }) {
  const client = useQueryClient();
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const member = useQuery({
    queryKey: adminKeys.member(id),
    queryFn: () => apiFetch<Member>(`/v1/admin/members/${id}`),
  });
  const canManage = can(session, 'access.manage');
  const isOwner = session.activeTenant?.isTenantAdmin ?? false;

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: adminKeys.member(id) });
    await client.invalidateQueries({ queryKey: ['admin', 'members'] });
  };

  const action = useMutation({
    mutationFn: async (run: { do: () => Promise<unknown>; success: string }) => {
      await run.do();
      return run.success;
    },
    onSuccess: async (text) => {
      setNotice({ tone: 'success', text });
      await refresh();
    },
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  });

  if (member.isPending) return <Loading />;
  if (member.isError) return <Alert tone="error">{errorMessage(member.error)}</Alert>;
  const m = member.data;
  const isSelf = m.userId === session.user.id;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[13px]">
        <Link href="/admin/people" className="text-primary hover:underline">
          People and access
        </Link>{' '}
        <span className="text-muted-foreground">/ {m.displayName}</span>
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[24px] font-semibold tracking-tight">{m.displayName}</h1>
        <MemberBadges member={m} />
      </div>
      <p className="-mt-4 text-muted-foreground">
        {m.email} · joined {formatDateTime(m.joinedAt)} · last sign-in {formatDateTime(m.lastLoginAt)}
      </p>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section title="Roles">
          {m.isTenantAdmin && (
            <p className="mb-3 text-[13px] text-muted-foreground">
              As an owner, {m.displayName.split(' ')[0]} can do everything in this organisation, whatever
              roles are listed.
            </p>
          )}
          {m.assignments.length === 0 ? (
            <p className="text-muted-foreground">No roles yet.</p>
          ) : (
            <ul className="divide-y divide-muted">
              {m.assignments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span>
                    <span className="font-medium">{a.roleName}</span>
                    <span className="block text-xs text-muted-foreground">
                      {a.scopeType === 'TENANT'
                        ? scopeLabel('TENANT')
                        : `${scopeLabel(a.scopeType)}: ${a.scopeName ?? '—'}`}
                    </span>
                  </span>
                  {canManage && (!isSelf || isOwner) && (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Remove ${a.roleName}`}
                      disabled={action.isPending}
                      onClick={() =>
                        action.mutate({
                          do: () =>
                            apiFetch(`/v1/admin/members/${m.membershipId}/assignments/${a.id}`, {
                              method: 'DELETE',
                            }),
                          success: `${a.roleName} removed.`,
                        })
                      }
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canManage && (!isSelf || isOwner) && <AddRole member={m} onAdded={() => void refresh()} />}
          {isSelf && !isOwner && (
            <p className="mt-3 text-[13px] text-muted-foreground">You can’t change your own roles.</p>
          )}
        </Section>

        {canManage && (
          <Section title="Account">
            <div className="flex flex-col items-start gap-3">
              {m.invitationPending ? (
                <Button
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({
                      do: () =>
                        apiFetch(`/v1/admin/members/${m.membershipId}/invitation`, { method: 'POST' }),
                      success: 'A new invitation link has been sent.',
                    })
                  }
                >
                  Resend invitation
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({
                      do: () =>
                        apiFetch(`/v1/admin/members/${m.membershipId}/password-reset`, { method: 'POST' }),
                      success: 'A password reset link has been sent.',
                    })
                  }
                >
                  Send password reset link
                </Button>
              )}
              {!isSelf && (
                <Button
                  variant={m.status === 'ACTIVE' ? 'danger' : 'outline'}
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({
                      do: () =>
                        apiFetch(`/v1/admin/members/${m.membershipId}`, {
                          method: 'PATCH',
                          body: { status: m.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' },
                        }),
                      success: m.status === 'ACTIVE' ? 'Access suspended.' : 'Access restored.',
                    })
                  }
                >
                  {m.status === 'ACTIVE' ? 'Suspend access' : 'Restore access'}
                </Button>
              )}
              {isOwner && (
                <Button
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({
                      do: () =>
                        apiFetch(`/v1/admin/members/${m.membershipId}`, {
                          method: 'PATCH',
                          body: { isTenantAdmin: !m.isTenantAdmin },
                        }),
                      success: m.isTenantAdmin ? 'Ownership removed.' : 'Made an owner.',
                    })
                  }
                >
                  {m.isTenantAdmin ? 'Remove as owner' : 'Make owner'}
                </Button>
              )}
              <p className="text-[13px] text-muted-foreground">
                Suspending takes effect on their next action. Their account stays, so access can be restored.
              </p>
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
