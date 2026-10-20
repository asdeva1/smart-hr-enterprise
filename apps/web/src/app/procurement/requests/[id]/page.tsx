'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { OrderDialog, RequestDialog } from '@/components/procurement/forms';
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
  procurementKeys,
  REQUEST_STATUS_LABEL,
  REQUEST_STATUS_TONE,
  type PurchaseRequest,
} from '@/lib/procurement';

export default function RequestPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="Procurement" session={session}>
          <RequestDetail id={id} session={session} />
        </AppShell>
      )}
    </RequireSession>
  );
}

function RequestDetail({ id, session }: { id: string; session: SessionView }) {
  const client = useQueryClient();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const request = useQuery({
    queryKey: procurementKeys.request(id),
    queryFn: () => apiFetch<PurchaseRequest>(`/v1/procurement/requests/${id}`),
  });
  const act = useMutation({
    mutationFn: (action: 'submit' | 'cancel') =>
      apiFetch<PurchaseRequest>(`/v1/procurement/requests/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: procurementKeys.all }),
  });
  if (request.isPending) return <Loading />;
  if (request.isError) return <Alert tone="error">{errorMessage(request.error)}</Alert>;
  const r = request.data;
  const open = r.status === 'DRAFT' || r.status === 'PENDING_APPROVAL';
  const mine = r.mine;
  return (
    <>
      <PageHeader
        title={r.number ?? 'Draft request'}
        description={r.title}
        actions={
          <div className="flex flex-wrap gap-2">
            {r.status === 'DRAFT' && mine && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {open && mine && (
              <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate('cancel')}>
                Withdraw
              </Button>
            )}
            {r.status === 'DRAFT' && mine && (
              <Button disabled={act.isPending} onClick={() => act.mutate('submit')}>
                Send for approval
              </Button>
            )}
            {r.status === 'APPROVED' && can(session, 'procurement.manage') && (
              <Button onClick={() => setOrdering(true)}>Create purchase order</Button>
            )}
          </div>
        }
      />
      <p>
        <Link href="/procurement" className="text-sm text-primary hover:underline">
          ← All requests
        </Link>
      </p>
      {act.isError && <Alert tone="error">{errorMessage(act.error)}</Alert>}
      <dl className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Status</dt>
          <dd>
            <Badge tone={REQUEST_STATUS_TONE[r.status]}>{REQUEST_STATUS_LABEL[r.status]}</Badge>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Requested by</dt>
          <dd>{r.employee.name}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Estimate</dt>
          <dd className="tabular-nums">{money(r.estimatedTotal, r.currency)}</dd>
        </div>
      </dl>
      {r.justification && <p className="text-sm text-muted-foreground">Why: {r.justification}</p>}
      {r.status === 'DRAFT' && r.decisionNote && <Alert tone="info">Sent back: {r.decisionNote}</Alert>}
      {r.status === 'REJECTED' && r.decisionNote && <Alert tone="error">Rejected: {r.decisionNote}</Alert>}
      {r.status === 'PENDING_APPROVAL' && r.approvalRequest && (
        <Alert tone="info">
          Waiting for approval.{' '}
          <Link href={`/approvals/${r.approvalRequest.id}`} className="font-medium underline">
            See the approval
          </Link>
        </Alert>
      )}
      {r.orders.length > 0 && (
        <p className="text-sm">
          Orders:{' '}
          {r.orders.map((o) => (
            <Link
              key={o.id}
              href={`/procurement/orders/${o.id}`}
              className="mr-3 text-primary hover:underline"
            >
              {o.number ?? 'Draft'} ({ORDER_STATUS_LABEL[o.status]})
            </Link>
          ))}
        </p>
      )}
      <Table label="Items requested">
        <thead>
          <tr>
            <Th>Item</Th>
            <Th className="text-right">Quantity</Th>
            <Th className="text-right">Unit price</Th>
            <Th className="text-right">Amount</Th>
          </tr>
        </thead>
        <tbody>
          {r.lines.map((l) => (
            <tr key={l.id}>
              <Td>{l.description}</Td>
              <Td className="text-right tabular-nums">{l.quantity}</Td>
              <Td className="text-right tabular-nums">{money(l.estimatedUnitPrice, r.currency)}</Td>
              <Td className="text-right tabular-nums">{money(l.amount, r.currency)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {editing && (
        <RequestDialog request={r} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />
      )}
      {ordering && (
        <OrderDialog
          fromRequest={r}
          onClose={() => setOrdering(false)}
          onSaved={(o) => router.push(`/procurement/orders/${o.id}`)}
        />
      )}
    </>
  );
}
