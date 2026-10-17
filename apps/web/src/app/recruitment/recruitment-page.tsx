'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import type { SessionView } from '@/lib/api';
import { hasFeature } from '@/lib/permissions';
import { cn } from '@/lib/utils';

/** Wraps every recruitment page: signed in, in an organisation whose plan includes recruitment. */
export function RecruitmentPage({ children }: { children: (session: SessionView) => ReactNode }) {
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="Recruitment" session={session}>
          {hasFeature(session, 'recruitment') ? (
            children(session)
          ) : (
            <Alert tone="info">Your organisation’s plan doesn’t include recruitment.</Alert>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}

const TABS = [
  { href: '/recruitment', label: 'Openings' },
  { href: '/recruitment/interviews', label: 'My interviews' },
];

export function RecruitmentTabs({ active }: { active: string }) {
  return (
    <nav aria-label="Recruitment" className="flex gap-1 overflow-x-auto border-b border-border">
      {TABS.map((t) => (
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
