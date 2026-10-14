'use client';

import Link from 'next/link';
import { PlatformPage } from '@/components/platform/platform-page';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { formatDate, usePlatformTenants } from '@/lib/plan';

const SUB_TONE = {
  TRIAL: 'info',
  ACTIVE: 'success',
  PAST_DUE: 'warning',
  CANCELLED: 'warning',
  SUSPENDED: 'danger',
  EXPIRED: 'danger',
} as const;

function Organisations() {
  const tenants = usePlatformTenants();
  return (
    <>
      <PageHeader
        title="Organisations"
        description="Every customer organisation with its plan and subscription."
      />
      {tenants.isPending ? (
        <Loading />
      ) : tenants.isError ? (
        <Alert tone="error">{errorMessage(tenants.error)}</Alert>
      ) : tenants.data.length === 0 ? (
        <EmptyState title="No organisations yet" />
      ) : (
        <Table label="Organisations">
          <thead>
            <tr>
              <Th>Organisation</Th>
              <Th>Plan</Th>
              <Th>Subscription</Th>
              <Th>Renews / ends</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {tenants.data.map((t) => {
              const sub = t.subscription;
              return (
                <tr key={t.id}>
                  <Td>
                    <Link
                      href={`/platform/organisations/${t.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {t.name}
                    </Link>
                    <div className="font-mono text-xs text-muted-foreground">{t.slug}</div>
                  </Td>
                  <Td>{sub ? `${sub.planVersion.plan.name} v${sub.planVersion.version}` : '—'}</Td>
                  <Td>
                    {sub ? (
                      <Badge tone={SUB_TONE[sub.status]}>{sub.status.replace('_', ' ').toLowerCase()}</Badge>
                    ) : (
                      <Badge>none</Badge>
                    )}
                    {t.status !== 'ACTIVE' && (
                      <span className="ml-2">
                        <Badge tone="danger">organisation {t.status.toLowerCase()}</Badge>
                      </span>
                    )}
                  </Td>
                  <Td>
                    {sub?.status === 'TRIAL'
                      ? formatDate(sub.trialEndsAt)
                      : sub?.currentPeriodEnd
                        ? formatDate(sub.currentPeriodEnd)
                        : sub
                          ? 'Open-ended'
                          : '—'}
                  </Td>
                  <Td>{formatDate(t.createdAt)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}

export default function PlatformOrganisationsPage() {
  return <PlatformPage active="Organisations">{() => <Organisations />}</PlatformPage>;
}
