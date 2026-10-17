'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import {
  CHANGE_LABEL,
  employeeKeys,
  formatDay,
  type ChangeStatus,
  type EmploymentChange,
} from '@/lib/employees';
import { show } from '../../[id]/history-panel';

const STATUS: Record<
  ChangeStatus,
  { label: string; tone: 'info' | 'success' | 'danger' | 'warning' | 'neutral' }
> = {
  PENDING: { label: 'Waiting for approval', tone: 'info' },
  APPROVED: { label: 'Approved and applied', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  RETURNED: { label: 'Sent back', tone: 'warning' },
  CANCELLED: { label: 'Withdrawn', tone: 'neutral' },
};

/** One employment change: what would change, from when, and where its approval stands. */
export function ChangeDetail({ id, userId }: { id: string; userId: string }) {
  const client = useQueryClient();
  const change = useQuery({
    queryKey: employeeKeys.change(id),
    queryFn: () => apiFetch<EmploymentChange>(`/v1/employee-changes/${id}`),
  });
  const withdraw = useMutation({
    mutationFn: () =>
      apiFetch<EmploymentChange>(`/v1/employee-changes/${id}/cancel`, { method: 'POST', body: {} }),
    onSuccess: async (c) => {
      client.setQueryData(employeeKeys.change(id), c);
      await client.invalidateQueries({ queryKey: employeeKeys.all });
    },
  });
  if (change.isPending) return <Loading />;
  if (change.isError) return <Alert tone="error">{errorMessage(change.error)}</Alert>;
  const c = change.data;
  const open = c.status === 'PENDING' || c.status === 'RETURNED';

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[13px]">
        <Link href={`/employees/${c.employee.id}`} className="text-primary hover:underline">
          {c.employee.name}
        </Link>{' '}
        <span className="text-muted-foreground">/ Employment change</span>
      </nav>
      <PageHeader
        title={`${c.actionLabel} from ${formatDay(c.effectiveDate)}`}
        description={`${c.employee.name} · ${c.employee.employeeCode}`}
        actions={<Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>}
      />
      {withdraw.isError && <Alert tone="error">{errorMessage(withdraw.error)}</Alert>}
      <section
        aria-labelledby="what-heading"
        className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5"
      >
        <h2 id="what-heading" className="font-semibold">
          {c.status === 'APPROVED' ? 'What changed' : 'What would change'}
        </h2>
        <ul className="text-sm">
          {Object.entries(c.changes).map(([field, ch]) => (
            <li key={field}>
              {CHANGE_LABEL[field] ?? field}:{' '}
              {ch.from === null || ch.from === undefined
                ? show(field, ch.to)
                : `${show(field, ch.from)} → ${show(field, ch.to)}`}
            </li>
          ))}
        </ul>
        {c.note && <p className="text-[13px] text-muted-foreground">“{c.note}”</p>}
        {c.decisionNote && <p className="text-[13px]">Approver’s note: {c.decisionNote}</p>}
        <p className="text-xs text-muted-foreground">
          Asked for on {formatDay(c.createdAt.slice(0, 10))}. It is checked again when approved, and applied
          then.
        </p>
      </section>
      <div className="flex flex-wrap gap-3">
        {c.approvalRequest && (
          <Link
            href={`/approvals/${c.approvalRequest.id}`}
            className="text-[13px] text-primary hover:underline"
          >
            See the approval
          </Link>
        )}
        {open && c.requestedByUserId === userId && (
          <Button size="sm" variant="outline" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>
            Withdraw
          </Button>
        )}
      </div>
    </>
  );
}
