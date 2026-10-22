'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { UpgradeRequest } from './upgrade-request';

export default function UpgradePage() {
  return (
    <RequireSession permission="settings.manage">
      {(session) => (
        <AppShell active="Plan and usage" session={session}>
          <UpgradeRequest
            organisation={session.activeTenant?.name ?? ''}
            name={session.user.displayName}
            email={session.user.email}
            currentPlan={session.activeTenant?.plan.name ?? null}
          />
        </AppShell>
      )}
    </RequireSession>
  );
}
