'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { SecuritySettings } from './security-settings';

export default function AccountSecurityPage() {
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="" session={session}>
          <SecuritySettings session={session} />
        </AppShell>
      )}
    </RequireSession>
  );
}
