'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { PoliciesAdmin } from './policies-admin';

export default function ApprovalPoliciesPage() {
  return (
    <RequireSession permission="approvals.manage">
      {(session) => (
        <AppShell active="Approval policies" session={session}>
          <PoliciesAdmin session={session} />
        </AppShell>
      )}
    </RequireSession>
  );
}
