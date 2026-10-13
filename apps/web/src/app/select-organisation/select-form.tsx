'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import { ApiError, apiFetch, safeNextPath, type SessionView } from '@/lib/api';
import { useSetSession } from '@/lib/session';

export function SelectOrganisation() {
  const router = useRouter();
  const params = useSearchParams();
  const setSession = useSetSession();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();

  async function choose(tenantId: string) {
    setBusy(tenantId);
    setError(undefined);
    try {
      setSession(await apiFetch<SessionView>('/v1/auth/tenant', { method: 'POST', body: { tenantId } }));
      router.replace(safeNextPath(params.get('next')));
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : 'We couldn’t reach Smart HR. Please try again.');
      setBusy(undefined);
    }
  }

  return (
    <RequireSession requireTenant={false}>
      {(session) => (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[26px] font-semibold tracking-tight">Choose an organisation</h1>
            <p className="text-muted-foreground">
              You belong to more than one. You can switch later from the top bar.
            </p>
          </div>
          {error && <Alert tone="error">{error}</Alert>}
          {session.memberships.length === 0 ? (
            <Alert tone="info">
              You don’t belong to any organisation yet. Ask your administrator to invite you.
            </Alert>
          ) : (
            <ul className="flex flex-col gap-2">
              {session.memberships.map((m) => (
                <li key={m.tenantId}>
                  <button
                    type="button"
                    onClick={() => void choose(m.tenantId)}
                    disabled={busy !== undefined}
                    className="flex min-h-12 w-full items-center justify-between rounded-md border border-border bg-card px-4 text-left hover:border-primary disabled:opacity-60"
                  >
                    <span className="font-medium">{m.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {busy === m.tenantId ? 'Opening…' : m.isTenantAdmin ? 'Administrator' : 'Member'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </RequireSession>
  );
}
