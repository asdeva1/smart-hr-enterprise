'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import { hasFeature } from '@/lib/permissions';
import { HolidaysAdmin } from './holidays-admin';

/** Holidays serve attendance and leave, so either plan feature is enough. */
export default function HolidaysPage() {
  return (
    <RequireSession permission="leave.configure">
      {(session) => (
        <AppShell active="Leave" session={session}>
          {hasFeature(session, 'leave.basic') || hasFeature(session, 'attendance.basic') ? (
            <HolidaysAdmin session={session} />
          ) : (
            <Alert tone="info">Your organisation’s plan doesn’t include attendance or leave.</Alert>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}
