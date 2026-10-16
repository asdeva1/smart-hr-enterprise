'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { NewEmployeeForm } from './new-employee-form';

export default function NewEmployeePage() {
  return (
    <RequireSession permission="employees.manage">
      {(session) => (
        <AppShell active="Employees" session={session}>
          <NewEmployeeForm />
        </AppShell>
      )}
    </RequireSession>
  );
}
