'use client';

import { useParams } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { ApprovalDetail } from './approval-detail';

export default function ApprovalPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="Approvals" session={session}>
          <ApprovalDetail id={id} />
        </AppShell>
      )}
    </RequireSession>
  );
}
