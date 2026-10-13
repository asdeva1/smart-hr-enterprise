'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { SecurityPolicy } from './security-policy';

export default function SecurityPolicyPage() {
  return (
    <RequireSession permission="security.manage">
      {(session) => (
        <AppShell active="Security policy" session={session}>
          <SecurityPolicy session={session} />
        </AppShell>
      )}
    </RequireSession>
  );
}
