'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { AuditLog } from './audit-log';

export default function AuditPage() {
  return (
    <RequireSession permission="audit.view">
      {(session) => (
        <AppShell active="Audit log" session={session}>
          <AuditLog />
        </AppShell>
      )}
    </RequireSession>
  );
}
