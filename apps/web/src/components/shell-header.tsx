'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useSignOut } from '@/hooks/use-sign-out';
import { ApiError, apiFetch, type SessionView } from '@/lib/api';
import { useSetSession } from '@/lib/session';
import { Button } from './ui/button';

export function ShellHeader({ session }: { session: SessionView }) {
  const signOut = useSignOut();
  const setSession = useSetSession();
  const client = useQueryClient();
  const [switchError, setSwitchError] = useState<string>();
  const initials = session.user.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  async function switchTenant(tenantId: string) {
    setSwitchError(undefined);
    try {
      const view = await apiFetch<SessionView>('/v1/auth/tenant', { method: 'POST', body: { tenantId } });
      // Everything cached belongs to the previous organisation.
      client.clear();
      setSession(view);
    } catch (error) {
      setSwitchError(error instanceof ApiError ? error.detail : 'Could not switch organisation');
    }
  }

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-8 py-3">
      <div className="mr-auto flex flex-col">
        {session.memberships.length > 1 ? (
          <label className="flex flex-col">
            <span className="sr-only">Organisation</span>
            <select
              className="h-9 rounded-md border border-border bg-card px-2 font-semibold"
              value={session.activeTenant?.id ?? ''}
              onChange={(e) => void switchTenant(e.target.value)}
            >
              {session.memberships.map((m) => (
                <option key={m.tenantId} value={m.tenantId}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <b>{session.activeTenant?.name ?? 'No organisation'}</b>
        )}
        <span className="text-xs text-muted-foreground">
          {session.activeTenant?.isTenantAdmin ? 'Organisation administrator' : 'Member'}
        </span>
        {switchError && (
          <span role="alert" className="text-xs text-danger">
            {switchError}
          </span>
        )}
      </div>
      <Link
        href="/account/security"
        className="flex items-center gap-2.5 rounded-md px-2 py-1 hover:bg-muted"
      >
        <span
          aria-hidden="true"
          className="grid size-9 place-items-center rounded-full bg-primary-soft text-[13px] font-semibold text-primary"
        >
          {initials}
        </span>
        <span className="flex flex-col text-left leading-tight">
          <span className="text-sm font-medium">{session.user.displayName}</span>
          <span className="text-xs text-muted-foreground">Account and security</span>
        </span>
      </Link>
      <Button variant="outline" size="sm" onClick={() => void signOut()}>
        Sign out
      </Button>
    </header>
  );
}
