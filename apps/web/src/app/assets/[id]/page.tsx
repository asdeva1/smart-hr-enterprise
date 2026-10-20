'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { AssignDialog, RetireDialog, ReturnDialog } from '@/components/assets/dialogs';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { ASSET_STATUS_LABEL, ASSET_STATUS_TONE, assetKeys, type AssetDetail } from '@/lib/assets';
import { money } from '@/lib/expenses';

export default function AssetPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireSession permission="assets.view">
      {(session) => (
        <AppShell active="Assets" session={session}>
          <AssetView id={id} />
        </AppShell>
      )}
    </RequireSession>
  );
}

function AssetView({ id }: { id: string }) {
  const client = useQueryClient();
  const [dialog, setDialog] = useState<'assign' | 'return' | 'retire' | null>(null);
  const asset = useQuery({
    queryKey: assetKeys.detail(id),
    queryFn: () => apiFetch<AssetDetail>(`/v1/assets/${id}`),
  });
  const toggleRepair = useMutation({
    mutationFn: (status: 'IN_STOCK' | 'UNDER_REPAIR') =>
      apiFetch(`/v1/assets/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => client.invalidateQueries({ queryKey: assetKeys.all }),
  });
  if (asset.isPending) return <Loading />;
  if (asset.isError) return <Alert tone="error">{errorMessage(asset.error)}</Alert>;
  const a = asset.data;
  const d = a.depreciation;
  return (
    <>
      <PageHeader
        title={`${a.tag} · ${a.name}`}
        description={a.category}
        actions={
          a.canManage ? (
            <div className="flex flex-wrap gap-2">
              {a.status === 'IN_STOCK' && <Button onClick={() => setDialog('assign')}>Give out</Button>}
              {a.status === 'ASSIGNED' && <Button onClick={() => setDialog('return')}>Take back</Button>}
              {a.status === 'IN_STOCK' && (
                <Button
                  variant="outline"
                  disabled={toggleRepair.isPending}
                  onClick={() => toggleRepair.mutate('UNDER_REPAIR')}
                >
                  Send for repair
                </Button>
              )}
              {a.status === 'UNDER_REPAIR' && (
                <Button
                  variant="outline"
                  disabled={toggleRepair.isPending}
                  onClick={() => toggleRepair.mutate('IN_STOCK')}
                >
                  Back from repair
                </Button>
              )}
              {(a.status === 'IN_STOCK' || a.status === 'UNDER_REPAIR') && (
                <Button variant="outline" onClick={() => setDialog('retire')}>
                  Retire
                </Button>
              )}
            </div>
          ) : null
        }
      />
      <p>
        <Link href="/assets" className="text-sm text-primary hover:underline">
          ← All assets
        </Link>
      </p>
      {toggleRepair.isError && <Alert tone="error">{errorMessage(toggleRepair.error)}</Alert>}
      <dl className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Status</dt>
          <dd>
            <Badge tone={ASSET_STATUS_TONE[a.status]}>{ASSET_STATUS_LABEL[a.status]}</Badge>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Serial number</dt>
          <dd>{a.serialNumber ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Bought</dt>
          <dd>
            {a.purchaseDate}
            {a.vendor ? ` · ${a.vendor.name}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Cost</dt>
          <dd className="tabular-nums">{money(a.purchaseCost, a.currency)}</dd>
        </div>
      </dl>
      <section aria-labelledby="dep" className="flex flex-col gap-2">
        <h2 id="dep" className="text-base font-semibold">
          Depreciation
        </h2>
        <dl className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Per month</dt>
            <dd className="tabular-nums">{money(d.monthlyCharge, a.currency)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Months used</dt>
            <dd className="tabular-nums">
              {d.monthsElapsed} of {a.usefulLifeMonths}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Written off so far</dt>
            <dd className="tabular-nums">{money(d.accumulated, a.currency)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Book value</dt>
            <dd className="font-medium tabular-nums">{money(d.bookValue, a.currency)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          Straight line over the useful life, down to a resale value of {money(a.salvageValue, a.currency)}.
          {a.retiredOn ? ` Stopped on ${a.retiredOn} (${a.retireReason}).` : ''}
        </p>
      </section>
      <section aria-labelledby="hist" className="flex flex-col gap-2">
        <h2 id="hist" className="text-base font-semibold">
          Who has had it
        </h2>
        {a.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Never given out.</p>
        ) : (
          <Table label="Assignment history">
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>From</Th>
                <Th>Until</Th>
                <Th>Condition out</Th>
                <Th>Condition back</Th>
              </tr>
            </thead>
            <tbody>
              {a.history.map((h) => (
                <tr key={h.id}>
                  <Td>
                    {h.employee.name} ({h.employee.code})
                  </Td>
                  <Td className="whitespace-nowrap">{h.assignedOn}</Td>
                  <Td className="whitespace-nowrap">{h.returnedOn ?? 'Now'}</Td>
                  <Td>{h.conditionOut ?? '—'}</Td>
                  <Td>{h.conditionIn ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
      {dialog === 'assign' && <AssignDialog asset={a} onClose={() => setDialog(null)} />}
      {dialog === 'return' && <ReturnDialog asset={a} onClose={() => setDialog(null)} />}
      {dialog === 'retire' && <RetireDialog asset={a} onClose={() => setDialog(null)} />}
    </>
  );
}
