'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import type { SessionView } from '@/lib/api';
import { can, hasFeature } from '@/lib/permissions';
import { cn } from '@/lib/utils';

export function PayrollPage({
  children,
  permission,
}: {
  children: (session: SessionView) => ReactNode;
  permission?: string;
}) {
  return (
    <RequireSession {...(permission ? { permission } : {})}>
      {(session) => (
        <AppShell active="Payroll" session={session}>
          {hasFeature(session, 'payroll') ? (
            children(session)
          ) : (
            <Alert tone="info">Your organisation’s plan doesn’t include payroll.</Alert>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}

export function PayrollTabs({ session, active }: { session: SessionView; active: string }) {
  const tabs = [
    ...(can(session, 'payroll.view') ? [{ href: '/payroll', label: 'Payroll runs' }] : []),
    { href: '/payroll/me', label: 'My payslips' },
    ...(can(session, 'payroll.configure') ? [{ href: '/payroll/setup', label: 'Set-up' }] : []),
  ];
  return (
    <nav aria-label="Payroll" className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === active ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 border-transparent px-3.5 py-3 font-medium whitespace-nowrap text-[#3e4c57]',
            t.href === active && 'border-primary font-semibold text-primary',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
