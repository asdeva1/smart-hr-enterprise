'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import { DataExport } from './data-export';

export default function DataExportPage() {
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="Your data" session={session}>
          {session.activeTenant?.isTenantAdmin ? (
            <DataExport session={session} />
          ) : (
            <Alert tone="warning">Only an owner of this organisation can export its data.</Alert>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}
