'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { ClaimDialog } from '@/components/expenses/claim-form';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import { CLAIM_STATUS_LABEL, CLAIM_STATUS_TONE, expenseKeys, money, type Claim } from '@/lib/expenses';
import { can } from '@/lib/permissions';

export default function ClaimPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="Expenses" session={session}>
          <ClaimDetail id={id} session={session} />
        </AppShell>
      )}
    </RequireSession>
  );
}

function ClaimDetail({ id, session }: { id: string; session: SessionView }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const claim = useQuery({
    queryKey: expenseKeys.claim(id),
    queryFn: () => apiFetch<Claim>(`/v1/expenses/claims/${id}`),
  });
  const act = useMutation({
    mutationFn: (action: 'submit' | 'cancel') =>
      apiFetch<Claim>(`/v1/expenses/claims/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: expenseKeys.all }),
  });
  if (claim.isPending) return <Loading />;
  if (claim.isError) return <Alert tone="error">{errorMessage(claim.error)}</Alert>;
  const c = claim.data;
  const open = c.status === 'DRAFT' || c.status === 'PENDING_APPROVAL';
  return (
    <>
      <PageHeader
        title={c.number ?? 'Draft claim'}
        description={c.title}
        actions={
          <div className="flex flex-wrap gap-2">
            {c.status === 'DRAFT' && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {open && (
              <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate('cancel')}>
                Withdraw
              </Button>
            )}
            {c.status === 'DRAFT' && (
              <Button disabled={act.isPending} onClick={() => act.mutate('submit')}>
                Send for approval
              </Button>
            )}
            {c.status === 'APPROVED' && can(session, 'expenses.manage') && (
              <Button onClick={() => setPaying(true)}>Mark as paid</Button>
            )}
          </div>
        }
      />
      <p>
        <Link href="/expenses" className="text-sm text-primary hover:underline">
          ← All claims
        </Link>
      </p>
      {act.isError && <Alert tone="error">{errorMessage(act.error)}</Alert>}
      <dl className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Status</dt>
          <dd>
            <Badge tone={CLAIM_STATUS_TONE[c.status]}>{CLAIM_STATUS_LABEL[c.status]}</Badge>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Employee</dt>
          <dd>{c.employee.name}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Total</dt>
          <dd className="tabular-nums">{money(c.total, c.currency)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Payment</dt>
          <dd>{c.paidAt ? `${c.paymentReference} · ${c.paidAt.slice(0, 10)}` : '—'}</dd>
        </div>
      </dl>
      {c.status === 'DRAFT' && c.decisionNote && (
        <Alert tone="info">Sent back with a note: {c.decisionNote}</Alert>
      )}
      {c.status === 'REJECTED' && c.decisionNote && <Alert tone="error">Rejected: {c.decisionNote}</Alert>}
      {c.status === 'PENDING_APPROVAL' && c.approvalRequest && (
        <Alert tone="info">
          Waiting for approval.{' '}
          <Link href={`/approvals/${c.approvalRequest.id}`} className="font-medium underline">
            See the approval
          </Link>
        </Alert>
      )}
      <Table label="Expenses in this claim">
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Category</Th>
            <Th>What it was for</Th>
            <Th>Receipt</Th>
            <Th className="text-right">Amount</Th>
          </tr>
        </thead>
        <tbody>
          {c.lines.map((l) => (
            <tr key={l.id}>
              <Td className="whitespace-nowrap">{l.date}</Td>
              <Td>{l.category}</Td>
              <Td>{l.description}</Td>
              <Td>{l.receiptNumber ?? '—'}</Td>
              <Td className="text-right tabular-nums">{money(l.amount, c.currency)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {editing && (
        <ClaimDialog claim={c} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />
      )}
      {paying && <PayDialog id={id} onClose={() => setPaying(false)} />}
    </>
  );
}

function PayDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const client = useQueryClient();
  const [reference, setReference] = useState('');
  const pay = useMutation({
    mutationFn: () =>
      apiFetch<Claim>(`/v1/expenses/claims/${id}/pay`, { method: 'POST', body: { reference } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: expenseKeys.all });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Mark as paid"
      description="Record the bank transfer or cash reference once you have paid the employee."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pay.isPending || reference.trim().length < 2} onClick={() => pay.mutate()}>
            Mark as paid
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {pay.isError && <Alert tone="error">{errorMessage(pay.error)}</Alert>}
        <Field id="pay-ref" label="Payment reference">
          <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
