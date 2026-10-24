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
  feature,
}: {
  children: (session: SessionView) => ReactNode;
  permission?: string;
  /** An extra module the page needs on top of attendance itself. */
  feature?: string;
}) {
  return (
    <RequireSession {...(permission ? { permission } : {})}>
      {(session) => (
        <AppShell active="Attendance" session={session}>
          {hasFeature(session, 'attendance.basic') && (!feature || hasFeature(session, feature)) ? (
            children(session)
          ) : (
            <Alert tone="info">
              {feature
                ? 'Your organisation’s plan doesn’t include this part of attendance.'
                : 'Your organisation’s plan doesn’t include attendance.'}
            </Alert>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}
