'use client';

import { AppShell } from '@/components/app-shell';
import { Dashboard } from '@/components/home/dashboard';
import { MyHome, TeamCard } from '@/components/home/cards';
import { RequireSession } from '@/components/require-session';
import { hasFeature } from '@/lib/permissions';

export default function HomePage() {
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="Dashboard" session={session}>
          <Dashboard
            session={session}
            personal={
              <>
                {hasFeature(session, 'self_service.manager') && <TeamCard />}
                {hasFeature(session, 'self_service.employee') ? (
                  <section className="flex flex-col gap-3">
                    <h2 className="text-[17px] font-semibold">Your day</h2>
                    <MyHome />
                  </section>
                ) : (
                  <section className="rounded-lg border border-border bg-card p-5">
                    <h2 className="text-[15px] font-semibold">Your day</h2>
                    <p className="mt-2 max-w-prose text-muted-foreground">
                      Use the menu to open the parts of the system your organisation has switched on.
                    </p>
                  </section>
                )}
              </>
            }
          />
        </AppShell>
      )}
    </RequireSession>
  );
}
