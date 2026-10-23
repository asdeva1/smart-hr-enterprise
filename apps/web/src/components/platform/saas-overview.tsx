'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { formatDate, usePlans, usePlatformTenants, type PlatformTenantRow } from '@/lib/plan';

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <b className="text-[28px] leading-none font-semibold tracking-tight">{value}</b>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function daysUntil(value: string | null): number | null {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
}

function count<T>(rows: T[], key: (row: T) => string): [string, number][] {
  const map = new Map<string, number>();
  for (const row of rows) map.set(key(row), (map.get(key(row)) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

const SUB_LABEL: Record<string, string> = {
  TRIAL: 'On trial',
  ACTIVE: 'Paying',
  PAST_DUE: 'Payment overdue',
  GRACE: 'Grace period',
  EXPIRED: 'Ended',
  SUSPENDED: 'Suspended',
  NONE: 'No subscription',
};

/** The landing page of an account that administers the SaaS and belongs to no organisation. */
export function SaasOverview({ name }: { name: string }) {
  const tenants = usePlatformTenants();
  const plans = usePlans();
  if (tenants.isPending) return <Loading />;
  const rows: PlatformTenantRow[] = tenants.data ?? [];
  const live = rows.filter((r) => r.status === 'ACTIVE');
  const trialsEnding = rows
    .filter((r) => r.subscription?.status === 'TRIAL' && r.subscription.trialEndsAt)
    .map((r) => ({ row: r, days: daysUntil(r.subscription!.trialEndsAt) ?? 0 }))
    .filter((t) => t.days <= 14)
    .sort((a, b) => a.days - b.days);
  const bySub = count(rows, (r) => SUB_LABEL[r.subscription?.status ?? 'NONE'] ?? 'Other');
  const byPlan = count(rows, (r) => r.subscription?.planVersion.plan.name ?? 'No plan');
  const recent = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  const publishedPlans = (plans.data ?? []).filter(
    (p) => p.status === 'ACTIVE' && p.versions.some((v) => v.status === 'PUBLISHED'),
  ).length;

  return (
    <>
      <PageHeader
        title={`Welcome, ${name}`}
        description="SmartHR SaaS administration. Every organisation, plan and feature of the product is managed from here."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Organisations" value={rows.length} hint={`${live.length} active`} />
        <Stat
          label="Paying"
          value={rows.filter((r) => r.subscription?.status === 'ACTIVE').length}
          hint="On an active subscription"
        />
        <Stat
          label="On trial"
          value={rows.filter((r) => r.subscription?.status === 'TRIAL').length}
          hint={`${trialsEnding.length} ending within 14 days`}
        />
        <Stat label="Published plans" value={publishedPlans} hint="Open for new subscriptions" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
          <h2 className="text-[15px] font-semibold">Subscriptions by state</h2>
          {bySub.length === 0 ? (
            <p className="text-muted-foreground">No organisations yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {bySub.map(([label, n]) => (
                <li key={label} className="flex items-center justify-between">
                  <span>{label}</span>
                  <b>{n}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
          <h2 className="text-[15px] font-semibold">Organisations by plan</h2>
          {byPlan.length === 0 ? (
            <p className="text-muted-foreground">No organisations yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {byPlan.map(([label, n]) => (
                <li key={label} className="flex items-center justify-between">
                  <span>{label}</span>
                  <b>{n}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
          <h2 className="text-[15px] font-semibold">Trials ending soon</h2>
          {trialsEnding.length === 0 ? (
            <p className="text-muted-foreground">No trial ends in the next 14 days.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {trialsEnding.map(({ row, days }) => (
                <li key={row.id} className="flex items-center justify-between gap-3">
                  <Link href={`/platform/organisations/${row.id}`} className="text-primary hover:underline">
                    {row.name}
                  </Link>
                  <Badge tone={days <= 3 ? 'danger' : 'warning'}>
                    {days <= 0 ? 'Ends today' : `${days} day${days === 1 ? '' : 's'} left`}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
          <h2 className="text-[15px] font-semibold">Newest organisations</h2>
          {recent.length === 0 ? (
            <p className="text-muted-foreground">Organisations appear here as they sign up.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3">
                  <Link href={`/platform/organisations/${r.id}`} className="text-primary hover:underline">
                    {r.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-[15px] font-semibold">Deciding plans</h2>
        <p className="mt-2 max-w-prose text-muted-foreground">
          Open{' '}
          <Link href="/platform/features" className="text-primary hover:underline">
            Features and specifications
          </Link>{' '}
          to see everything the product does, what is built today and which plans include it. Then set prices
          and limits in the{' '}
          <Link href="/platform/plans" className="text-primary hover:underline">
            Plan catalogue
          </Link>
          .
        </p>
      </section>
    </>
  );
}
