'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { EmployeeImport } from './employee-import';

export default function EmployeeImportPage() {
  return (
    <RequireSession permission="employees.manage">
      {(session) => (
        <AppShell active="Employees" session={session}>
          <EmployeeImport />
        </AppShell>
      )}
    </RequireSession>
  );
}
