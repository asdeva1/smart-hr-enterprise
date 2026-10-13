'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { SystemStatus } from '@/components/system-status';

export default function HomePage() {
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="Dashboard" session={session}>
          <div className="flex flex-col gap-1">
            <h1 className="text-[26px] font-semibold tracking-tight">
              Welcome, {session.user.displayName.split(' ')[0]}
            </h1>
            <p className="text-muted-foreground">
              Workforce, attendance and approval figures appear here once those modules store real data.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <section className="rounded-lg border border-border bg-card p-5">
              <h2 className="text-[15px] font-semibold">Nothing to show yet</h2>
              <p className="mt-2 max-w-prose text-muted-foreground">
                You’re signed in to {session.activeTenant?.name}. Employee records arrive in Phase 8; until
                then you can manage your sign-in security from your account page.
              </p>
            </section>
            <SystemStatus />
          </div>
        </AppShell>
      )}
    </RequireSession>
  );
}
