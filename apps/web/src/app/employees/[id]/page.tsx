'use client';

import { useParams } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { EmployeeProfile } from './employee-profile';

export default function EmployeePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireSession permission="employees.view">
      {(session) => (
        <AppShell active="Employees" session={session}>
          <EmployeeProfile id={id} session={session} />
        </AppShell>
      )}
    </RequireSession>
  );
}
