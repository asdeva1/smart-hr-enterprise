'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { OrderDialog, RequestDialog } from '@/components/procurement/forms';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import { money } from '@/lib/expenses';
import { can, hasFeature } from '@/lib/permissions';
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  procurementKeys,
  REQUEST_STATUS_LABEL,
  REQUEST_STATUS_TONE,
  type OrderRow,
  type RequestRow,
} from '@/lib/procurement';

type Tab = 'mine' | 'all' | 'orders';

export default function ProcurementPage() {
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="Procurement" session={session}>
          {hasFeature(session, 'procurement') ? (
            <Procurement session={session} />
          ) : (
            <Alert tone="info">Your organisation’s plan doesn’t include procurement.</Alert>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}

function Procurement({ session }: { session: SessionView }) {
  const router = useRouter();
  const buyer = can(session, 'procurement.manage');
  const seesOrders = buyer || can(session, 'procurement.view');
  const [tab, setTab] = useState<Tab>('mine');
  const [requesting, setRequesting] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const tabs: { value: Tab; label: string }[] = [
    { value: 'mine', label: 'My requests' },
    ...(can(session, 'procurement.view') ? [{ value: 'all' as const, label: 'All requests' }] : []),
    ...(seesOrders ? [{ value: 'orders' as const, label: 'Purchase orders' }] : []),
  ];
  return (
    <>
      <PageHeader
        title="Procurement"
        description="Ask for things to be bought, then order them from vendors and record what arrives."
        actions={
          <>
            <Button variant={buyer ? 'outline' : 'primary'} onClick={() => setRequesting(true)}>
              New request
            </Button>
            {buyer && <Button onClick={() => setOrdering(true)}>New purchase order</Button>}
          </>
        }
      />
      <Tabs label="Procurement" value={tab} onChange={setTab} options={tabs} />
      {tab === 'orders' ? <Orders /> : <Requests scope={tab} />}
      {requesting && (
        <RequestDialog
          onClose={() => setRequesting(false)}
          onSaved={(r) => router.push(`/procurement/requests/${r.id}`)}
        />
      )}
      {ordering && (
        <OrderDialog
          onClose={() => setOrdering(false)}
          onSaved={(o) => router.push(`/procurement/orders/${o.id}`)}
        />
      )}
    </>
  );
}

function Requests({ scope }: { scope: 'mine' | 'all' }) {
  const rows = useQuery({
    queryKey: procurementKeys.requests(scope),
    queryFn: () => apiFetch<RequestRow[]>(`/v1/procurement/requests?scope=${scope}`),
  });
  if (rows.isPending) return <Loading />;
  if (rows.isError) return <Alert tone="error">{errorMessage(rows.error)}</Alert>;
  if (rows.data.length === 0) {
    return <EmptyState title="No requests yet">Ask for anything the business needs to buy.</EmptyState>;
  }
  return (
    <Table label="Purchase requests">
      <thead>
        <tr>
          <Th>Number</Th>
          <Th>Request</Th>
          {scope === 'all' && <Th>Requested by</Th>}
          <Th className="text-right">Estimate</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {rows.data.map((r) => (
          <tr key={r.id}>
            <Td className="whitespace-nowrap">{r.number ?? 'Draft'}</Td>
            <Td>
              <Link
                href={`/procurement/requests/${r.id}`}
                className="font-medium text-primary hover:underline"
              >
                {r.title}
              </Link>
            </Td>
            {scope === 'all' && <Td>{r.employee.name}</Td>}
            <Td className="text-right tabular-nums">{money(r.estimatedTotal, r.currency)}</Td>
            <Td>
              <Badge tone={REQUEST_STATUS_TONE[r.status]}>{REQUEST_STATUS_LABEL[r.status]}</Badge>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Orders() {
  const rows = useQuery({
    queryKey: procurementKeys.orders,
    queryFn: () => apiFetch<OrderRow[]>('/v1/procurement/orders'),
  });
  if (rows.isPending) return <Loading />;
  if (rows.isError) return <Alert tone="error">{errorMessage(rows.error)}</Alert>;
  if (rows.data.length === 0) {
    return (
      <EmptyState title="No purchase orders yet">
        Raise one from an approved request or from scratch.
      </EmptyState>
    );
  }
  return (
    <Table label="Purchase orders">
      <thead>
        <tr>
          <Th>Number</Th>
          <Th>Vendor</Th>
          <Th>Date</Th>
          <Th className="text-right">Total</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {rows.data.map((o) => (
          <tr key={o.id}>
            <Td className="whitespace-nowrap">
              <Link href={`/procurement/orders/${o.id}`} className="font-medium text-primary hover:underline">
                {o.number ?? 'Draft'}
              </Link>
            </Td>
            <Td>{o.vendor.name}</Td>
            <Td className="whitespace-nowrap">{o.orderDate}</Td>
            <Td className="text-right tabular-nums">{money(o.total, o.currency)}</Td>
            <Td>
              <Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
