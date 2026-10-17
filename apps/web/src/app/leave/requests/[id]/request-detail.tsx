'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { formatDay } from '@/lib/employees';
import {
  days,
  leaveDates,
  leaveKeys,
  LEAVE_STATUS_LABEL,
  LEAVE_STATUS_TONE,
  type LeaveRequest,
} from '@/lib/leave';

export function RequestDetail({ id }: { id: string }) {
  const client = useQueryClient();
  const request = useQuery({
    queryKey: leaveKeys.request(id),
    queryFn: () => apiFetch<LeaveRequest>(`/v1/leave/requests/${id}`),
  });
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () =>
      apiFetch<LeaveRequest>(`/v1/leave/requests/${id}/cancel`, {
        method: 'POST',
        body: reason.trim() ? { reason } : {},
      }),
    onSuccess: async (r) => {
      client.setQueryData(leaveKeys.request(id), r);
      setConfirming(false);
      await client.invalidateQueries({ queryKey: ['leave'] });
      await client.invalidateQueries({ queryKey: ['attendance'] });
    },
  });
  if (request.isPending) return <Loading />;
  if (request.isError) return <Alert tone="error">{errorMessage(request.error)}</Alert>;
  const r = request.data;
  const open = r.status === 'PENDING' || r.status === 'RETURNED';

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[13px]">
        <Link href="/leave" className="text-primary hover:underline">
          Leave
        </Link>{' '}
        <span className="text-muted-foreground">/ Request</span>
      </nav>
      <PageHeader
        title={`${r.leaveType.name}: ${leaveDates(r.from, r.to, r.halfDay)}`}
        description={`${r.employee.name} · ${r.employee.employeeCode}`}
        actions={<Badge tone={LEAVE_STATUS_TONE[r.status]}>{LEAVE_STATUS_LABEL[r.status]}</Badge>}
      />
      {cancel.isError && <Alert tone="error">{errorMessage(cancel.error)}</Alert>}
      {r.status === 'CANCELLED' && r.cancelledAt && (
        <Alert tone="info">
          Cancelled on {formatDay(r.cancelledAt.slice(0, 10))}. Any days taken went back on the balance.
        </Alert>
      )}
      <section className="rounded-lg border border-border bg-card p-5">
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Days</dt>
            <dd className="tabular-nums">{days(r.days)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Paid</dt>
            <dd>{r.leaveType.paid ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Reason</dt>
            <dd>{r.reason}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Requested</dt>
            <dd>{formatDay(r.createdAt.slice(0, 10))}</dd>
          </div>
          {r.decisionNote && (
            <div>
              <dt className="text-xs text-muted-foreground">Note</dt>
              <dd>{r.decisionNote}</dd>
            </div>
          )}
        </dl>
      </section>
      <div className="flex flex-wrap items-end gap-3">
        {r.approvalRequest && (
          <Link
            href={`/approvals/${r.approvalRequest.id}`}
            className="text-[13px] text-primary hover:underline"
          >
            See the approval
          </Link>
        )}
        {r.canCancel && !confirming && (
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
            {open ? 'Withdraw' : 'Cancel leave'}
          </Button>
        )}
      </div>
      {confirming && (
        <section
          aria-label="Confirm cancellation"
          className="flex max-w-lg flex-col gap-3 rounded-md border border-warning/30 bg-warning-soft/40 p-4"
        >
          <p className="text-[13px]">
            {open
              ? 'Withdraw this request? The approver will no longer see it.'
              : `Cancel this leave? ${days(r.days)} go back on the balance.`}
          </p>
          {!open && (
            <Field id="cancel-reason" label="Reason (optional)">
              <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              {open ? 'Withdraw request' : 'Cancel leave'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
