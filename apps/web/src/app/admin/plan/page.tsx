'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { PlanOverview } from './plan-overview';

export default function PlanPage() {
  return (
    <RequireSession permission="settings.manage">
      {(session) => (
        <AppShell active="Plan and usage" session={session}>
          <PlanOverview />
        </AppShell>
      )}
    </RequireSession>
  );
}
