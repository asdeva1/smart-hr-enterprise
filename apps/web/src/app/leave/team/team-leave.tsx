'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import { todayIso } from '@/lib/employees';
import {
  leaveDates,
  leaveKeys,
  LEAVE_STATUS_LABEL,
  LEAVE_STATUS_TONE,
  useLeaveRequests,
  type HalfDay,
  type LeaveStatus,
} from '@/lib/leave';
import { LeaveTabs } from '../leave-tabs';

interface CalendarEntry {
  id: string;
  employee: { id: string; name: string; employeeCode: string };
  leaveType: string;
  from: string;
  to: string;
  halfDay: HalfDay | null;
  status: 'PENDING' | 'APPROVED';
}

const plusDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function TeamLeave({ session }: { session: SessionView }) {
  const [status, setStatus] = useState<LeaveStatus | ''>('PENDING');
  const requests = useLeaveRequests('team', status || undefined);
  const from = todayIso();
  const to = plusDays(from, 27);
  const away = useQuery({
    queryKey: leaveKeys.calendar(from, to),
    queryFn: () => apiFetch<{ entries: CalendarEntry[] }>(`/v1/leave/calendar?from=${from}&to=${to}`),
  });

  return (
    <>
      <PageHeader
        title="Leave"
        description="Leave for the people who report to you, or whose leave you look after."
      />
      <LeaveTabs session={session} active="/leave/team" />

      <section aria-labelledby="away-heading" className="flex flex-col gap-3">
        <h2 id="away-heading" className="text-[17px] font-semibold">
          Away in the next four weeks
        </h2>
        {away.isPending ? (
          <Loading />
        ) : away.isError ? (
          <Alert tone="error">{errorMessage(away.error)}</Alert>
        ) : away.data.entries.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nobody has leave booked.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {away.data.entries.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
              >
                <span>
                  <span className="font-medium">{e.employee.name}</span>{' '}
                  <span className="text-muted-foreground">· {e.leaveType}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{leaveDates(e.from, e.to, e.halfDay)}</span>
                  {e.status === 'PENDING' && <Badge tone="info">Waiting</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="team-requests-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="team-requests-heading" className="text-[17px] font-semibold">
            Requests
          </h2>
          <Field id="team-status" label="Show">
            <Select
              id="team-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as LeaveStatus | '')}
            >
              <option value="PENDING">Waiting for approval</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="">All</option>
            </Select>
          </Field>
        </div>
        {requests.isPending ? (
          <Loading />
        ) : requests.isError ? (
          <Alert tone="error">{errorMessage(requests.error)}</Alert>
        ) : requests.data.length === 0 ? (
          <EmptyState title="Nothing here">
            Requests from the people who report to you appear here, and in Approvals when they need you.
          </EmptyState>
        ) : (
          <Table label="Team leave requests">
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Dates</Th>
                <Th>Type</Th>
                <Th className="text-right">Days</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {requests.data.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <span className="font-medium">{r.employee.name}</span>{' '}
                    <span className="text-muted-foreground">{r.employee.employeeCode}</span>
                  </Td>
                  <Td>
                    <Link href={`/leave/requests/${r.id}`} className="text-primary hover:underline">
                      {leaveDates(r.from, r.to, r.halfDay)}
                    </Link>
                  </Td>
                  <Td>{r.leaveType.name}</Td>
                  <Td className="text-right tabular-nums">{r.days}</Td>
                  <Td>
                    <Badge tone={LEAVE_STATUS_TONE[r.status]}>{LEAVE_STATUS_LABEL[r.status]}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </>
  );
}
