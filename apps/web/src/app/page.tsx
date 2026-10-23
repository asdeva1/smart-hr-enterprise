'use client';

import { AppShell } from '@/components/app-shell';
import { MyHome, TeamCard } from '@/components/home/cards';
import { RequireSession } from '@/components/require-session';
import { SaasOverview } from '@/components/platform/saas-overview';
import { SystemStatus } from '@/components/system-status';
import type { SessionView } from '@/lib/api';
import { can, hasFeature } from '@/lib/permissions';

const saasOnly = (session: SessionView) => session.user.isPlatformAdmin && !session.activeTenant;

export default function HomePage() {
  return (
    <RequireSession>
      {(session) => (
        <AppShell active={saasOnly(session) ? 'Overview' : 'Dashboard'} session={session}>
          {saasOnly(session) ? (
            <SaasOverview name={session.user.displayName.split(' ')[0] ?? ''} />
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <h1 className="text-[26px] font-semibold tracking-tight">
                  Welcome, {session.user.displayName.split(' ')[0]}
                </h1>
                <p className="text-muted-foreground">{session.activeTenant?.name}</p>
              </div>
              {hasFeature(session, 'self_service.manager') && <TeamCard />}
              {hasFeature(session, 'self_service.employee') ? (
                <MyHome />
              ) : (
                <section className="rounded-lg border border-border bg-card p-5">
                  <h2 className="text-[15px] font-semibold">Your day</h2>
                  <p className="mt-2 max-w-prose text-muted-foreground">
                    Use the menu to open the parts of the system your organisation has switched on.
                  </p>
                </section>
              )}
              {can(session, 'settings.manage') && <SystemStatus />}
            </>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}
