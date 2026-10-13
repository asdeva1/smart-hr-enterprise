'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { emailField } from '@smart-hr/validation';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ScopePicker } from '@/components/scope-picker';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import {
  adminKeys,
  applyFieldErrors,
  errorMessage,
  formatDateTime,
  useRoles,
  type Member,
  type ScopeType,
} from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import { can } from '@/lib/permissions';

const PAGE_SIZE = 25;

export function MemberBadges({ member }: { member: Member }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {member.isTenantAdmin && <Badge tone="info">Owner</Badge>}
      {member.status === 'SUSPENDED' && <Badge tone="danger">Suspended</Badge>}
      {member.invitationPending && <Badge tone="warning">Invitation pending</Badge>}
      {!member.invitationPending && !member.mfaEnabled && <Badge>No two-step</Badge>}
    </span>
  );
}

const inviteFormSchema = z.object({
  email: emailField,
  displayName: z.string().trim().min(1, 'Enter a name').max(200),
});
type InviteValues = z.infer<typeof inviteFormSchema>;

function InviteForm({ onDone }: { onDone: (membershipId: string) => void }) {
  const client = useQueryClient();
  const roles = useRoles();
  const [formError, setFormError] = useState<string>();
  const [roleId, setRoleId] = useState('');
  const [scope, setScope] = useState<{ type: ScopeType; id: string }>({ type: 'TENANT', id: '' });
  const [scopeError, setScopeError] = useState<string>();
  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteFormSchema),
    defaultValues: { email: '', displayName: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    setScopeError(undefined);
    if (roleId && scope.type !== 'TENANT' && !scope.id) {
      setScopeError('Choose where this role applies');
      return;
    }
    try {
      const res = await apiFetch<{ membershipId: string }>('/v1/admin/members', {
        method: 'POST',
        body: {
          ...values,
          assignments: roleId ? [{ roleId, scopeType: scope.type, scopeId: scope.id || null }] : [],
        },
      });
      await client.invalidateQueries({ queryKey: ['admin', 'members'] });
      onDone(res.membershipId);
    } catch (error) {
      if (!applyFieldErrors(error, form.setError)) setFormError(errorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && <Alert tone="error">{formError}</Alert>}
      <Field id="invite-name" label="Name" error={errors.displayName?.message}>
        <Input
          autoFocus
          {...fieldAria('invite-name', errors.displayName?.message)}
          {...form.register('displayName')}
        />
      </Field>
      <Field
        id="invite-email"
        label="Work email"
        error={errors.email?.message}
        hint="They’ll get an email with a link to set their password."
      >
        <Input
          type="email"
          {...fieldAria('invite-email', errors.email?.message)}
          {...form.register('email')}
        />
      </Field>
      <Field id="invite-role" label="Role (optional)">
        <Select id="invite-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          <option value="">No role yet</option>
          {roles.data?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      {roleId && (
        <ScopePicker
          idPrefix="invite"
          scopeType={scope.type}
          scopeId={scope.id}
          error={scopeError}
          onChange={(type, id) => setScope({ type, id })}
        />
      )}
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="outline" onClick={() => onDone('')}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Sending…' : 'Send invitation'}
        </Button>
      </div>
    </form>
  );
}

export function PeopleAdmin({ session }: { session: SessionView }) {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [page, setPage] = useState(1);
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const canManage = can(session, 'access.manage');

  const members = useQuery({
    queryKey: adminKeys.members(deferredSearch, page),
    queryFn: () =>
      apiFetch<{ items: Member[]; total: number; page: number; pageSize: number }>(
        `/v1/admin/members?${new URLSearchParams({
          page: String(page),
          pageSize: String(PAGE_SIZE),
          ...(deferredSearch ? { search: deferredSearch } : {}),
        }).toString()}`,
      ),
    placeholderData: keepPreviousData,
  });
  const totalPages = members.data ? Math.max(1, Math.ceil(members.data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader
        title="People and access"
        description="Who can sign in to this organisation, and what each person can do."
        actions={canManage && <Button onClick={() => setInviting(true)}>Invite someone</Button>}
      />
      {notice && <Alert tone="success">{notice}</Alert>}
      <label className="flex max-w-md flex-col gap-1.5">
        <span className="text-[13px] font-medium">Search</span>
        <Input
          type="search"
          placeholder="Name or email"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </label>
      {members.isPending ? (
        <Loading />
      ) : members.isError ? (
        <Alert tone="error">{errorMessage(members.error)}</Alert>
      ) : members.data.items.length === 0 ? (
        <EmptyState title={deferredSearch ? 'Nobody matches that search' : 'No members yet'} />
      ) : (
        <>
          <Table label="Members">
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>Roles</Th>
                <Th>Status</Th>
                <Th>Last sign-in</Th>
              </tr>
            </thead>
            <tbody>
              {members.data.items.map((m) => (
                <tr key={m.membershipId}>
                  <Td>
                    <Link
                      href={`/admin/people/${m.membershipId}`}
                      className="font-semibold hover:text-primary hover:underline"
                    >
                      {m.displayName}
                    </Link>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  </Td>
                  <Td>
                    {m.assignments.length === 0 ? (
                      <span className="text-muted-foreground">
                        {m.isTenantAdmin ? 'Everything (owner)' : 'None'}
                      </span>
                    ) : (
                      <ul className="flex flex-col gap-0.5">
                        {m.assignments.map((a) => (
                          <li key={a.id}>
                            {a.roleName}
                            {a.scopeType !== 'TENANT' && (
                              <span className="text-muted-foreground">
                                {' '}
                                · {a.scopeName ?? 'Hidden scope'}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Td>
                  <Td>
                    <MemberBadges member={m} />
                  </Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{formatDateTime(m.lastLoginAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-muted-foreground">
              {members.data.total} {members.data.total === 1 ? 'person' : 'people'} · page {page} of{' '}
              {totalPages}
            </span>
            <span className="flex gap-2">
              <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </span>
          </nav>
        </>
      )}
      <Dialog
        open={inviting}
        onClose={() => setInviting(false)}
        title="Invite someone"
        description="They’ll join this organisation. If they already use Smart HR elsewhere, they keep their existing sign-in."
      >
        <InviteForm
          onDone={(id) => {
            setInviting(false);
            if (id) setNotice('Invitation sent.');
          }}
        />
      </Dialog>
    </>
  );
}
