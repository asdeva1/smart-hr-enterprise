'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { OrderDialog, ReceiveDialog } from '@/components/procurement/forms';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import { money } from '@/lib/expenses';
import { can } from '@/lib/permissions';
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  procurementKeys,
  type PurchaseOrder,
} from '@/lib/procurement';

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="Procurement" session={session}>
          <OrderDetail id={id} session={session} />
        </AppShell>
      )}
    </RequireSession>
  );
}

function OrderDetail({ id, session }: { id: string; session: SessionView }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const order = useQuery({
    queryKey: procurementKeys.order(id),
    queryFn: () => apiFetch<PurchaseOrder>(`/v1/procurement/orders/${id}`),
  });
  const act = useMutation({
    mutationFn: (action: 'submit' | 'cancel') =>
      apiFetch<PurchaseOrder>(`/v1/procurement/orders/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: procurementKeys.all }),
  });
  if (order.isPending) return <Loading />;
  if (order.isError) return <Alert tone="error">{errorMessage(order.error)}</Alert>;
  const o = order.data;
  const buyer = can(session, 'procurement.manage');
  const canCancel = o.status === 'DRAFT' || o.status === 'PENDING_APPROVAL' || o.status === 'APPROVED';
  return (
    <>
      <PageHeader
        title={o.number ?? 'Draft purchase order'}
        description={o.vendor.name}
        actions={
          buyer ? (
            <div className="flex flex-wrap gap-2">
              {o.status === 'DRAFT' && (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
              {canCancel && (
                <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate('cancel')}>
                  Cancel order
                </Button>
              )}
              {o.status === 'DRAFT' && (
                <Button disabled={act.isPending} onClick={() => act.mutate('submit')}>
                  Send for approval
                </Button>
              )}
              {(o.status === 'APPROVED' || o.status === 'PARTIALLY_RECEIVED') && (
                <Button onClick={() => setReceiving(true)}>Record goods received</Button>
              )}
            </div>
          ) : null
        }
      />
      <p>
        <Link href="/procurement" className="text-sm text-primary hover:underline">
          ← Procurement
        </Link>
      </p>
      {act.isError && <Alert tone="error">{errorMessage(act.error)}</Alert>}
      <dl className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Status</dt>
          <dd>
            <Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Order date</dt>
          <dd>{o.orderDate}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Expected by</dt>
          <dd>{o.expectedDate ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Total (incl. tax)</dt>
          <dd className="tabular-nums">{money(o.total, o.currency)}</dd>
        </div>
      </dl>
      {o.request && (
        <p className="text-sm">
          From request{' '}
          <Link href={`/procurement/requests/${o.request.id}`} className="text-primary hover:underline">
            {o.request.number} · {o.request.title}
          </Link>
        </p>
      )}
      {o.status === 'DRAFT' && o.decisionNote && <Alert tone="info">Sent back: {o.decisionNote}</Alert>}
      {o.status === 'REJECTED' && o.decisionNote && <Alert tone="error">Rejected: {o.decisionNote}</Alert>}
      {o.status === 'PENDING_APPROVAL' && o.approvalRequest && (
        <Alert tone="info">
          Waiting for approval.{' '}
          <Link href={`/approvals/${o.approvalRequest.id}`} className="font-medium underline">
            See the approval
          </Link>
        </Alert>
      )}
      <Table label="Items ordered">
        <thead>
          <tr>
            <Th>Item</Th>
            <Th className="text-right">Ordered</Th>
            <Th className="text-right">Received</Th>
            <Th className="text-right">Unit price</Th>
            <Th className="text-right">Tax</Th>
            <Th className="text-right">Amount</Th>
          </tr>
        </thead>
        <tbody>
          {o.lines.map((l) => (
            <tr key={l.id}>
              <Td>{l.description}</Td>
              <Td className="text-right tabular-nums">{l.quantity}</Td>
              <Td className="text-right tabular-nums">{l.receivedQuantity}</Td>
              <Td className="text-right tabular-nums">{money(l.unitPrice, o.currency)}</Td>
              <Td className="text-right tabular-nums">{l.taxRate}%</Td>
              <Td className="text-right tabular-nums">{money(l.amount, o.currency)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {o.receipts.length > 0 && (
        <section aria-labelledby="receipts" className="flex flex-col gap-2">
          <h2 id="receipts" className="text-base font-semibold">
            Goods received
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {o.receipts.map((g) => (
              <li key={g.id}>
                {g.number} · {g.receivedOn}
                {g.note ? ` · ${g.note}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
      {editing && (
        <OrderDialog order={o} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />
      )}
      {receiving && <ReceiveDialog order={o} onClose={() => setReceiving(false)} />}
    </>
  );
}
