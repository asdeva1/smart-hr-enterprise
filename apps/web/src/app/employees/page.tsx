'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { EmployeeDirectory } from './employee-directory';

export default function EmployeesPage() {
  return (
    <RequireSession permission="employees.view">
      {(session) => (
        <AppShell active="Employees" session={session}>
          <EmployeeDirectory session={session} />
        </AppShell>
      )}
    </RequireSession>
  );
}
