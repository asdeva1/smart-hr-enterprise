'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { ApprovalsInbox } from './approvals-inbox';

export default function ApprovalsPage() {
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="Approvals" session={session}>
          <ApprovalsInbox session={session} />
        </AppShell>
      )}
    </RequireSession>
  );
}
