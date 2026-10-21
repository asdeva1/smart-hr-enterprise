'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { IntegrationsAdmin } from './integrations-admin';

export default function IntegrationsPage() {
  return (
    <RequireSession permission="settings.manage">
      {(session) => (
        <AppShell active="Integrations" session={session}>
          <IntegrationsAdmin session={session} />
        </AppShell>
      )}
    </RequireSession>
  );
}
