'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { OrgChart } from './org-chart';

export default function OrgChartPage() {
  return (
    <RequireSession permission="employees.view">
      {(session) => (
        <AppShell active="Employees" session={session}>
          <OrgChart />
        </AppShell>
      )}
    </RequireSession>
  );
}
