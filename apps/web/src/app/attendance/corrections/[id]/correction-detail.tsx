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
  attendanceKeys,
  clockTime,
  CORRECTION_LABEL,
  CORRECTION_TONE,
  type Correction,
} from '@/lib/attendance';
import { formatDay } from '@/lib/employees';
import { useSession } from '@/lib/session';

/** One correction, for the employee who asked and for the approver who opens it from their inbox. */
export function CorrectionDetail({ id }: { id: string }) {
  const client = useQueryClient();
  const session = useSession();
  const correction = useQuery({
    queryKey: attendanceKeys.correction(id),
    queryFn: () => apiFetch<Correction>(`/v1/attendance/corrections/${id}`),
  });
  const cancel = useMutation({
    mutationFn: () =>
      apiFetch<Correction>(`/v1/attendance/corrections/${id}/cancel`, { method: 'POST', body: {} }),
    onSuccess: async (c) => {
      client.setQueryData(attendanceKeys.correction(id), c);
      await client.invalidateQueries({ queryKey: ['attendance'] });
    },
  });
  if (correction.isPending) return <Loading />;
  if (correction.isError) return <Alert tone="error">{errorMessage(correction.error)}</Alert>;
  const c = correction.data;
  const mine = session.data?.user.id === c.requestedByUserId;
  const open = c.status === 'PENDING' || c.status === 'RETURNED';

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[13px]">
        <Link href="/attendance" className="text-primary hover:underline">
          Attendance
        </Link>{' '}
        <span className="text-muted-foreground">/ Correction</span>
      </nav>
      <PageHeader
        title={`Correction for ${formatDay(c.date)}`}
        description={`${c.employee.name} · ${c.employee.employeeCode}`}
        actions={<Badge tone={CORRECTION_TONE[c.status]}>{CORRECTION_LABEL[c.status]}</Badge>}
      />
      {cancel.isError && <Alert tone="error">{errorMessage(cancel.error)}</Alert>}
      <section className="rounded-lg border border-border bg-card p-5">
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Clock-in</dt>
            <dd className="tabular-nums">{clockTime(c.inAt, c.timeZone)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Clock-out</dt>
            <dd className="tabular-nums">{clockTime(c.outAt, c.timeZone)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Reason</dt>
            <dd>{c.reason}</dd>
          </div>
          {c.decisionNote && (
            <div>
              <dt className="text-xs text-muted-foreground">Approver’s note</dt>
              <dd>{c.decisionNote}</dd>
            </div>
          )}
        </dl>
      </section>
      <div className="flex flex-wrap gap-2">
        {c.approvalRequest && (
          <Link
            href={`/approvals/${c.approvalRequest.id}`}
            className="text-[13px] text-primary hover:underline"
          >
            See the approval
          </Link>
        )}
        {mine && open && (
          <Button size="sm" variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
            Withdraw
          </Button>
        )}
      </div>
    </>
  );
}
