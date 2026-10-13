'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { errorMessage, formatDateTime } from '@/lib/admin';
import type { SessionView } from '@/lib/api';
import {
  formatAmount,
  STATUS_LABEL,
  STATUS_TONE,
  useInbox,
  useRequests,
  type RequestSummary,
} from '@/lib/approvals';
import { can } from '@/lib/permissions';

type View = 'inbox' | 'mine' | 'all';

export function ApprovalsInbox({ session }: { session: SessionView }) {
  const canViewAll = can(session, 'approvals.view_all');
  const [view, setView] = useState<View>('inbox');
  const options: { value: View; label: string }[] = [
    { value: 'inbox', label: 'Waiting for me' },
    { value: 'mine', label: 'My requests' },
    ...(canViewAll ? [{ value: 'all' as const, label: 'All requests' }] : []),
  ];

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Leave, expenses, purchases and other requests that need a decision."
      />
      <Tabs label="Approvals" value={view} onChange={setView} options={options} />
      {view === 'inbox' ? <Inbox /> : <RequestList view={view} />}
    </>
  );
}

function Inbox() {
  const inbox = useInbox();
  // Fixed per mount, so "overdue" doesn't flicker between renders.
  const [now] = useState(() => Date.now());
  if (inbox.isPending) return <Loading />;
  if (inbox.isError) return <Alert tone="error">{errorMessage(inbox.error)}</Alert>;
  if (inbox.data.length === 0) {
    return (
      <EmptyState title="Nothing is waiting for you">
        New requests you need to decide will appear here.
      </EmptyState>
    );
  }
  return (
    <Table label="Waiting for my decision">
      <thead>
        <tr>
          <Th>Request</Th>
          <Th>Type</Th>
          <Th>From</Th>
          <Th>Stage</Th>
          <Th className="text-right">Amount</Th>
          <Th>Due</Th>
        </tr>
      </thead>
      <tbody>
        {inbox.data.map((task) => {
          const overdue = task.dueAt !== null && Date.parse(task.dueAt) < now;
          return (
            <tr key={task.id}>
              <Td>
                <Link
                  href={`/approvals/${task.request.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {task.request.title}
                </Link>
                {task.delegatedFromMembershipId && (
                  <span className="ml-2">
                    <Badge tone="info">Delegated to you</Badge>
                  </span>
                )}
              </Td>
              <Td>{task.request.subjectLabel}</Td>
              <Td>{task.request.requestedBy.user.displayName}</Td>
              <Td>{task.stageName}</Td>
              <Td className="text-right font-mono tabular-nums">
                {formatAmount(task.request.amount, task.request.currency)}
              </Td>
              <Td>{overdue ? <Badge tone="danger">Overdue</Badge> : formatDateTime(task.dueAt)}</Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function RequestList({ view }: { view: 'mine' | 'all' }) {
  const [status, setStatus] = useState('');
  const requests = useRequests(view, status);
  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-[240px]">
        <label htmlFor="status-filter" className="mb-1.5 block text-[13px] font-medium">
          Status
        </label>
        <Select id="status-filter" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {(['PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED'] as const).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </div>
      {requests.isPending ? (
        <Loading />
      ) : requests.isError ? (
        <Alert tone="error">{errorMessage(requests.error)}</Alert>
      ) : requests.data.length === 0 ? (
        <EmptyState title="No requests">
          {view === 'mine'
            ? 'Requests you submit from any module appear here.'
            : 'Nothing matches this filter.'}
        </EmptyState>
      ) : (
        <RequestTable rows={requests.data} showRequester={view === 'all'} />
      )}
    </div>
  );
}

function RequestTable({ rows, showRequester }: { rows: RequestSummary[]; showRequester: boolean }) {
  return (
    <Table label="Requests">
      <thead>
        <tr>
          <Th>Request</Th>
          <Th>Type</Th>
          {showRequester && <Th>From</Th>}
          <Th className="text-right">Amount</Th>
          <Th>Submitted</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td>
              <Link href={`/approvals/${r.id}`} className="font-medium text-primary hover:underline">
                {r.title}
              </Link>
            </Td>
            <Td>{r.subjectLabel}</Td>
            {showRequester && <Td>{r.requestedBy.user.displayName}</Td>}
            <Td className="text-right font-mono tabular-nums">{formatAmount(r.amount, r.currency)}</Td>
            <Td>{formatDateTime(r.createdAt)}</Td>
            <Td>
              <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
