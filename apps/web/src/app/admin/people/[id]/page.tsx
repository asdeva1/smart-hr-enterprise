'use client';

import { useParams } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { MemberDetail } from './member-detail';

export default function MemberPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireSession permission="access.view">
      {(session) => (
        <AppShell active="People and access" session={session}>
          <MemberDetail id={id} session={session} />
        </AppShell>
      )}
    </RequireSession>
  );
}
