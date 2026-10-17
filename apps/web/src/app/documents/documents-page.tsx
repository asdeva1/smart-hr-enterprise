'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import type { SessionView } from '@/lib/api';
import { can, hasFeature } from '@/lib/permissions';
import { cn } from '@/lib/utils';

/** Wraps every documents page: signed in, in an organisation whose plan includes documents. */
export function DocumentsPage({
  children,
  permission,
}: {
  children: (session: SessionView) => ReactNode;
  permission?: string;
}) {
  return (
    <RequireSession {...(permission ? { permission } : {})}>
      {(session) => (
        <AppShell active="Documents" session={session}>
          {hasFeature(session, 'documents') ? (
            children(session)
          ) : (
            <Alert tone="info">Your organisation’s plan doesn’t include documents.</Alert>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}

const TABS: { href: string; label: string; needs?: string; feature?: string }[] = [
  { href: '/documents', label: 'My documents' },
  { href: '/documents/signatures', label: 'Signatures', feature: 'esignature' },
  { href: '/documents/expiring', label: 'Expiring', needs: 'documents.view' },
  { href: '/documents/templates', label: 'Letter templates', needs: 'documents.configure' },
];

export function DocumentsTabs({ session, active }: { session: SessionView; active: string }) {
  const tabs = TABS.filter(
    (t) => (!t.needs || can(session, t.needs)) && (!t.feature || hasFeature(session, t.feature)),
  );
  return (
    <nav aria-label="Documents" className="flex gap-1 overflow-x-auto border-b border-border">
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
