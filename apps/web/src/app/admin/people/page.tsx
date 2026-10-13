'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { PeopleAdmin } from './people-admin';

export default function PeoplePage() {
  return (
    <RequireSession permission="access.view">
      {(session) => (
        <AppShell active="People and access" session={session}>
          <PeopleAdmin session={session} />
        </AppShell>
      )}
    </RequireSession>
  );
}
