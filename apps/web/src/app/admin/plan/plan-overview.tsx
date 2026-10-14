'use client';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { errorMessage } from '@/lib/admin';
import { formatDate, formatLimit, STATUS_LABEL, STATUS_TONE, useTenantPlan } from '@/lib/plan';
import { cn } from '@/lib/utils';

/** The organisation's plan, what it includes and how much of each limit is used. Read-only for tenants. */
export function PlanOverview() {
  const plan = useTenantPlan();
  if (plan.isPending) return <Loading />;
  if (plan.isError) return <Alert tone="error">{errorMessage(plan.error)}</Alert>;
  const { entitlements: e, subscription: sub, features, limits } = plan.data;

  const modules = new Map<string, typeof features>();
  for (const f of features) modules.set(f.module, [...(modules.get(f.module) ?? []), f]);

  return (
    <>
      <PageHeader
        title="Plan and usage"
        description="What your organisation’s subscription includes. Contact your Smart HR account manager to change it."
      />

      {e.access === 'READ_ONLY' && (
        <Alert tone="error">
          Your subscription has {e.status === 'SUSPENDED' ? 'been suspended' : 'ended'}. Everyone can still
          view and export data, but nothing in paid modules can be changed until it is renewed. Nothing has
          been deleted.
        </Alert>
      )}
      {(e.status === 'GRACE' || e.status === 'PAST_DUE') && (
        <Alert tone="warning">
          {e.status === 'GRACE' ? 'Your trial or billing period has ended.' : 'A payment is overdue.'} Paid
          modules keep working until {formatDate(e.graceEndsAt)}, then become read-only.
        </Alert>
      )}

      <section aria-labelledby="plan-summary" className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="plan-summary" className="text-lg font-semibold">
              {e.plan ? `${e.plan.name} plan` : 'No plan'}
            </h2>
            {e.plan && <span className="text-[13px] text-muted-foreground">Version {e.plan.version}</span>}
          </div>
          <Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
        </div>
        {sub && (
          <dl className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4 text-sm">
            {sub.storedStatus === 'TRIAL' ? (
              <Detail label="Trial ends">{formatDate(sub.trialEndsAt)}</Detail>
            ) : (
              <Detail label={sub.cancelledAt ? 'Access ends' : 'Current period ends'}>
                {sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : 'Open-ended contract'}
              </Detail>
            )}
            <Detail label="Billing">
              {sub.billingPeriod === 'ANNUAL' ? 'Annual' : 'Monthly'} · {sub.currency}
            </Detail>
            <Detail label="Support">
              {sub.supportLevel.charAt(0) + sub.supportLevel.slice(1).toLowerCase()}
            </Detail>
            <Detail label="Add-ons">
              {sub.addons.length === 0
                ? 'None'
                : sub.addons.map((a) => `${a.name}${a.quantity > 1 ? ` × ${a.quantity}` : ''}`).join(', ')}
            </Detail>
          </dl>
        )}
      </section>

      <section aria-labelledby="limits-heading" className="flex flex-col gap-3">
        <h2 id="limits-heading" className="text-[15px] font-semibold">
          Limits
        </h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
          {limits.map((l) => {
            const pct =
              l.limit && l.used !== null ? Math.min(100, Math.round((l.used / l.limit) * 100)) : null;
            return (
              <div key={l.code} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
                <span className="text-[13px] text-muted-foreground">{l.label}</span>
                <span className="text-lg font-semibold tabular-nums">
                  {l.used !== null ? `${l.used.toLocaleString('en-IN')} of ` : ''}
                  {formatLimit(l.limit, l.unit)}
                </span>
                {pct !== null && (
                  <div
                    className="h-1.5 rounded-full bg-muted"
                    role="meter"
                    aria-label={`${l.label} used`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                  >
                    <div
                      className={cn('h-1.5 rounded-full', pct >= 90 ? 'bg-danger' : 'bg-primary')}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
                {l.used === null && (
                  <span className="text-xs text-muted-foreground">
                    Usage is counted once this module is in use
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="features-heading" className="flex flex-col gap-3">
        <h2 id="features-heading" className="text-[15px] font-semibold">
          Included modules
        </h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
          {[...modules.entries()].map(([module, list]) => (
            <div key={module} className="rounded-lg border border-border bg-card p-4">
              <h3 className="mb-2 font-semibold">{module}</h3>
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {list.map((f) => (
                  <li key={f.code} className="flex items-start gap-2">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mt-0.5 font-bold',
                        f.included ? 'text-success' : 'text-muted-foreground',
                      )}
                    >
                      {f.included ? '✓' : '–'}
                    </span>
                    <span className={f.included ? '' : 'text-muted-foreground'}>
                      {f.label}
                      <span className="sr-only">{f.included ? ' (included)' : ' (not included)'}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
