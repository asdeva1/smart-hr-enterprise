'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { RolesAdmin } from './roles-admin';

export default function RolesPage() {
  return (
    <RequireSession permission="access.view">
      {(session) => (
        <AppShell active="Roles" session={session}>
          <RolesAdmin session={session} />
        </AppShell>
      )}
    </RequireSession>
  );
}
