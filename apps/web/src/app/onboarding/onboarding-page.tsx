'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import type { SessionView } from '@/lib/api';
import { can, hasFeature } from '@/lib/permissions';
import { cn } from '@/lib/utils';

export function OnboardingPage({
  children,
  permission,
}: {
  children: (session: SessionView) => ReactNode;
  permission?: string;
}) {
  return (
    <RequireSession {...(permission ? { permission } : {})}>
      {(session) => (
        <AppShell active="Onboarding" session={session}>
          {hasFeature(session, 'onboarding') ? (
            children(session)
          ) : (
            <Alert tone="info">Your organisation’s plan doesn’t include onboarding.</Alert>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}

export function OnboardingTabs({ session, active }: { session: SessionView; active: string }) {
  const tabs = [
    { href: '/onboarding', label: 'My tasks' },
    ...(can(session, 'onboarding.manage') ? [{ href: '/onboarding/templates', label: 'Checklists' }] : []),
  ];
  return (
    <nav aria-label="Onboarding" className="flex gap-1 overflow-x-auto border-b border-border">
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
