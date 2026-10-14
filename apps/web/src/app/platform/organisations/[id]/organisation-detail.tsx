'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Tabs } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { formatDate, planKeys } from '@/lib/plan';
import { platformKeys, useTenantOverview, type TenantOverview } from '@/lib/platform';
import { SubscriptionManager } from './subscription-manager';

const STATUS_TONE = {
  ACTIVE: 'success',
  SUSPENDED: 'danger',
  OFFBOARDING: 'warning',
  ARCHIVED: 'neutral',
} as const;
const STATUS_TEXT = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended — no access',
  OFFBOARDING: 'Offboarding — read-only',
  ARCHIVED: 'Archived — no access',
} as const;

export function OrganisationDetail({ tenantId, usesLicence }: { tenantId: string; usesLicence: boolean }) {
  const overview = useTenantOverview(tenantId);
  const params = useSearchParams();
  const [tab, setTab] = useState<'overview' | 'subscription'>('overview');
  const created = params.get('created');

  if (overview.isPending) return <Loading />;
  if (overview.isError) return <Alert tone="error">{errorMessage(overview.error)}</Alert>;
  const { tenant } = overview.data;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[13px]">
        <Link href="/platform/organisations" className="text-primary hover:underline">
          Organisations
        </Link>{' '}
        <span className="text-muted-foreground">/ {tenant.name}</span>
      </nav>
      <PageHeader
        title={tenant.name}
        description={<span className="font-mono text-[13px]">{tenant.slug}</span>}
        actions={<Badge tone={STATUS_TONE[tenant.status]}>{STATUS_TEXT[tenant.status]}</Badge>}
      />
      {created && (
        <Alert tone="success">
          Organisation created.{' '}
          {created === 'invited'
            ? 'The owner has been emailed a link to set their password.'
            : 'The owner already had an account and can sign in now.'}
        </Alert>
      )}
      {usesLicence ? (
        <>
          <p className="text-[13px] text-muted-foreground">
            Modules and limits come from this installation’s{' '}
            <Link href="/platform/licence" className="text-primary hover:underline">
              licence
            </Link>
            .
          </p>
          <Overview data={overview.data} />
        </>
      ) : (
        <>
          <Tabs
            label="Organisation"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'overview', label: 'Overview' },
              { value: 'subscription', label: 'Subscription' },
            ]}
          />
          {tab === 'overview' ? (
            <Overview data={overview.data} />
          ) : (
            <SubscriptionManager tenantId={tenantId} />
          )}
        </>
      )}
    </>
  );
}

function Overview({ data }: { data: TenantOverview }) {
  const { tenant, owners, members, companies } = data;
  const client = useQueryClient();
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const [reason, setReason] = useState('');
  const [confirmSlug, setConfirmSlug] = useState('');
  const [name, setName] = useState(tenant.name);
  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/v1/platform/tenants/${tenant.id}/lifecycle`, { method: 'POST', body }),
    onSuccess: async (_r, body) => {
      setReason('');
      setConfirmSlug('');
      setNotice({
        tone: 'success',
        text:
          {
            rename: 'Renamed.',
            suspend: 'Suspended. Nobody can use this organisation until it is reactivated.',
            reactivate: 'Reactivated.',
            start_offboarding: 'Offboarding started. Members can view and export, but not change anything.',
            cancel_offboarding: 'Offboarding cancelled.',
            archive: 'Archived. Nobody can use it; its data is retained.',
          }[String(body.action)] ?? 'Done.',
      });
      await client.invalidateQueries({ queryKey: platformKeys.overview(tenant.id) });
      await client.invalidateQueries({ queryKey: planKeys.tenants });
    },
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  });
  const withReason = reason ? { reason } : {};

  return (
    <div className="flex flex-col gap-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <section aria-labelledby="facts-heading" className="rounded-lg border border-border bg-card p-5">
        <h2 id="facts-heading" className="mb-3 font-semibold">
          At a glance
        </h2>
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Created</dt>
            <dd>{formatDate(tenant.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Active members</dt>
            <dd className="tabular-nums">{members.ACTIVE ?? 0}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Companies</dt>
            <dd className="tabular-nums">{companies}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Two-step verification</dt>
            <dd>{tenant.requireMfa ? 'Required for everyone' : 'Optional'}</dd>
          </div>
          {tenant.offboardingAt && (
            <div>
              <dt className="text-xs text-muted-foreground">Offboarding since</dt>
              <dd>{formatDate(tenant.offboardingAt)}</dd>
            </div>
          )}
        </dl>
        <h3 className="mt-4 mb-1 text-[13px] font-semibold">Owners</h3>
        <ul className="text-[13px]">
          {owners.map((o) => (
            <li key={o.email}>
              {o.displayName} · {o.email}
              {o.status !== 'ACTIVE' ? ' (suspended)' : ''}
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="lifecycle-heading"
        className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5"
      >
        <h2 id="lifecycle-heading" className="font-semibold">
          Lifecycle
        </h2>
        <div className="flex flex-wrap items-end gap-2">
          <Field id="rename" label="Name">
            <Input id="rename" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button
            size="sm"
            variant="outline"
            disabled={act.isPending || name.trim() === tenant.name || name.trim().length < 2}
            onClick={() => act.mutate({ action: 'rename', name })}
          >
            Rename
          </Button>
        </div>
        <Field id="lifecycle-reason" label="Reason (recorded in the organisation’s audit log)">
          <Input id="lifecycle-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {tenant.status === 'SUSPENDED' ? (
            <Button
              size="sm"
              disabled={act.isPending}
              onClick={() => act.mutate({ action: 'reactivate', ...withReason })}
            >
              Reactivate
            </Button>
          ) : (
            tenant.status !== 'ARCHIVED' && (
              <Button
                size="sm"
                variant="danger"
                disabled={act.isPending || reason.length < 3}
                onClick={() => act.mutate({ action: 'suspend', reason })}
              >
                Suspend access
              </Button>
            )
          )}
          {tenant.status === 'ACTIVE' && (
            <Button
              size="sm"
              variant="outline"
              disabled={act.isPending || reason.length < 3}
              onClick={() => act.mutate({ action: 'start_offboarding', reason })}
            >
              Start offboarding
            </Button>
          )}
          {tenant.status === 'OFFBOARDING' && (
            <Button
              size="sm"
              variant="outline"
              disabled={act.isPending}
              onClick={() => act.mutate({ action: 'cancel_offboarding', ...withReason })}
            >
              Cancel offboarding
            </Button>
          )}
        </div>
        {tenant.status === 'OFFBOARDING' && (
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-danger/30 bg-danger-soft/40 p-3">
            <Field id="archive-confirm" label={`Type ${tenant.slug} to archive`}>
              <Input
                id="archive-confirm"
                className="font-mono"
                value={confirmSlug}
                onChange={(e) => setConfirmSlug(e.target.value)}
              />
            </Field>
            <Button
              size="sm"
              variant="danger"
              disabled={act.isPending || reason.length < 3 || confirmSlug !== tenant.slug}
              onClick={() => act.mutate({ action: 'archive', reason, confirmSlug })}
            >
              Archive organisation
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Suspending and archiving end all access at once. Offboarding keeps members on read-only so they can
          export their data. Nothing is deleted by any of these.
        </p>
      </section>
    </div>
  );
}
