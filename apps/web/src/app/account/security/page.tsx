'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { Delegations, EmailPreferences } from './approval-settings';
import { SecuritySettings } from './security-settings';

export default function AccountSecurityPage() {
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="" session={session}>
          <SecuritySettings session={session} />
          {session.activeTenant && !session.activeTenant.mfaEnrolmentRequired && (
            <>
              <EmailPreferences />
              <Delegations />
            </>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}
