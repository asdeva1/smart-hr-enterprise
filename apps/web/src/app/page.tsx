import { AppShell } from '@/components/app-shell';
import { SystemStatus } from '@/components/system-status';

export default function HomePage() {
  return (
    <AppShell active="Dashboard">
      <div className="flex flex-col gap-1">
        <h1 className="text-[26px] font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Workforce, attendance and approval figures appear here once those modules store real data.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-[15px] font-semibold">Nothing to show yet</h2>
          <p className="mt-2 max-w-prose text-muted-foreground">
            This build contains the platform foundation only: the API, background worker, database with tenant
            isolation, and this web shell. Employee records arrive in Phase 8.
          </p>
        </section>
        <SystemStatus />
      </div>
    </AppShell>
  );
}
