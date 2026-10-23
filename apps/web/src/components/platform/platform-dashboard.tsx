'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FEATURES, LIMITS } from '@smart-hr/entitlements';
import Link from 'next/link';
import { Table, Td, Th } from '@/components/ui/table';
import { ReauthPrompt } from '@/components/reauth-prompt';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/admin';
import { ApiError, apiFetch, type SessionView } from '@/lib/api';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { formatDate, planKeys, usePlans, usePlatformTenants, type PlatformTenantRow } from '@/lib/plan';

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

/** The platform dashboard: customers, their plans, and where to change an organisation's plan and features. */
interface Demo {
  id: string;
  name: string;
  slug: string;
  email: string;
  password: string;
}

/** Makes a demo organisation on the Launch plan and shows its sign-in once. */
function DemoOrganisation({ session }: { session: SessionView }) {
  const client = useQueryClient();
  const [demo, setDemo] = useState<Demo>();
  const [error, setError] = useState<string>();
  const [reauth, setReauth] = useState(false);
  const create = useMutation({
    mutationFn: () => apiFetch<Demo>('/v1/platform/demo-organisation', { method: 'POST' }),
    onSuccess: async (d) => {
      setError(undefined);
      setDemo(d);
      await client.invalidateQueries({ queryKey: planKeys.tenants });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'REAUTH_REQUIRED') setReauth(true);
      else setError(errorMessage(e));
    },
  });
  return (
    <>
      <Button variant="outline" disabled={create.isPending} onClick={() => create.mutate()}>
        Create demo organisation
      </Button>
      {reauth && (
        <ReauthPrompt
          reason="Confirm it’s you before creating a demo organisation."
          mfaEnabled={session.user.mfaEnabled}
          onCancel={() => setReauth(false)}
          onDone={() => {
            setReauth(false);
            create.mutate();
          }}
        />
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {demo && (
        <div
          role="status"
          className="fixed right-6 bottom-6 z-50 flex w-[min(92vw,420px)] flex-col gap-2 rounded-lg border border-border bg-card p-5 shadow-lg"
        >
          <b>{demo.name} is ready</b>
          <p className="text-sm text-muted-foreground">
            Shown once. Sign out, then sign in with these. It has every feature (SmartHR Launch plan).
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-mono select-all">{demo.email}</dd>
            <dt className="text-muted-foreground">Password</dt>
            <dd className="font-mono select-all">{demo.password}</dd>
          </dl>
          <Button variant="outline" onClick={() => setDemo(undefined)}>
            I have saved it
          </Button>
        </div>
      )}
    </>
  );
}

export function PlatformDashboard({ session }: { session: SessionView }) {
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
        title="Platform dashboard"
        description="Companies that have bought SmartHR, the plans they are on, and where to change their features."
        actions={<DemoOrganisation session={session} />}
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

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Plan details</h2>
        <Table label="Plans">
          <thead>
            <tr>
              <Th>Plan</Th>
              <Th>Organisations</Th>
              <Th>Features</Th>
              <Th>Limits</Th>
              <Th>Price</Th>
              <Th>Trial</Th>
            </tr>
          </thead>
          <tbody>
            {(plans.data ?? [])
              .filter((p) => p.status === 'ACTIVE')
              .map((p) => {
                const v = p.versions.find((x) => x.status === 'PUBLISHED');
                if (!v) return null;
                const price = v.prices[0];
                return (
                  <tr key={p.id}>
                    <Td>
                      <b>{p.name}</b>
                      <div className="text-xs text-muted-foreground">
                        {p.code} · v{v.version}
                      </div>
                    </Td>
                    <Td>{rows.filter((r) => r.subscription?.planVersion.plan.code === p.code).length}</Td>
                    <Td>
                      {v.features.length} of {Object.keys(FEATURES).length}
                    </Td>
                    <Td className="text-xs">
                      {Object.entries(LIMITS)
                        .map(
                          ([k, l]) =>
                            `${l.label}: ${v.limits[k] === null || v.limits[k] === undefined ? 'unlimited' : v.limits[k]}`,
                        )
                        .join(' · ')}
                    </Td>
                    <Td>
                      {price
                        ? `${price.currency} ${price.amount} ${price.billingPeriod.toLowerCase()}`
                        : 'Not priced'}
                    </Td>
                    <Td>{v.trialDays > 0 ? `${v.trialDays} days` : '—'}</Td>
                  </tr>
                );
              })}
          </tbody>
        </Table>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Companies and their plans</h2>
        {rows.length === 0 ? (
          <p className="text-muted-foreground">No organisations yet.</p>
        ) : (
          <Table label="Companies">
            <thead>
              <tr>
                <Th>Company</Th>
                <Th>Plan</Th>
                <Th>Subscription</Th>
                <Th>Renews or ends</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>{r.name}</Td>
                  <Td>{r.subscription?.planVersion.plan.name ?? 'No plan'}</Td>
                  <Td>{SUB_LABEL[r.subscription?.status ?? 'NONE'] ?? 'Other'}</Td>
                  <Td>{formatDate(r.subscription?.currentPeriodEnd ?? r.subscription?.trialEndsAt)}</Td>
                  <Td>
                    <Link
                      href={`/platform/organisations/${r.id}?tab=subscription`}
                      className="font-semibold text-primary hover:underline"
                    >
                      Change plan and features
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </>
  );
}
