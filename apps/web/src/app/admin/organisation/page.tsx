'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { OrganisationAdmin } from './organisation-admin';

export default function OrganisationPage() {
  return (
    <RequireSession permission="org.view">
      {(session) => (
        <AppShell active="Organisation" session={session}>
          <OrganisationAdmin session={session} />
        </AppShell>
      )}
    </RequireSession>
  );
}
