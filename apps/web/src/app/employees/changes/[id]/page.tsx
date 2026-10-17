'use client';

import { useParams } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { ChangeDetail } from './change-detail';

export default function EmploymentChangePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="Employees" session={session}>
          <ChangeDetail id={id} userId={session.user.id} />
        </AppShell>
      )}
    </RequireSession>
  );
}
