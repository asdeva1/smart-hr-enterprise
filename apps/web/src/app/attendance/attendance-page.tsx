'use client';

import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import type { SessionView } from '@/lib/api';
import { hasFeature } from '@/lib/permissions';

/** Wraps every attendance page: signed in, in an organisation whose plan includes attendance. */
export function AttendancePage({
  children,
  permission,
}: {
  children: (session: SessionView) => ReactNode;
  permission?: string;
}) {
  return (
    <RequireSession {...(permission ? { permission } : {})}>
      {(session) => (
        <AppShell active="Attendance" session={session}>
          {hasFeature(session, 'attendance.basic') ? (
            children(session)
          ) : (
            <Alert tone="info">Your organisation’s plan doesn’t include attendance.</Alert>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}
