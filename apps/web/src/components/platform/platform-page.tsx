'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import type { SessionView } from '@/lib/api';

/**
 * Wraps a platform-console page. Platform administrators need no organisation to use it. Only decides what
 * to show: every /v1/platform route checks the platform administrator flag itself.
 */
export function PlatformPage({
  active,
  children,
}: {
  active: string;
  children: (session: SessionView) => ReactNode;
}) {
  return (
    <RequireSession requireTenant={false}>
      {(session) =>
        session.user.isPlatformAdmin ? (
          <AppShell active={active} session={session}>
            {children(session)}
          </AppShell>
        ) : (
          <div className="grid min-h-screen place-items-center p-8">
            <div className="flex max-w-md flex-col gap-3 text-center">
              <h1 className="text-xl font-semibold">This page is for platform operators</h1>
              <p className="text-muted-foreground">You need a platform administrator account to use it.</p>
              <Link href="/" className="text-primary hover:underline">
                Back to the dashboard
              </Link>
            </div>
          </div>
        )
      }
    </RequireSession>
  );
}
