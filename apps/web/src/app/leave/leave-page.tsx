'use client';

import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import type { SessionView } from '@/lib/api';
import { hasFeature } from '@/lib/permissions';

/** Wraps every leave page: signed in, in an organisation whose plan includes leave. */
export function LeavePage({
  children,
  permission,
}: {
  children: (session: SessionView) => ReactNode;
  permission?: string;
}) {
  return (
    <RequireSession {...(permission ? { permission } : {})}>
      {(session) => (
        <AppShell active="Leave" session={session}>
          {hasFeature(session, 'leave.basic') ? (
            children(session)
          ) : (
            <Alert tone="info">Your organisation’s plan doesn’t include leave.</Alert>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}
