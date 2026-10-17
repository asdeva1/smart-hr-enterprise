'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import type { SessionView } from '@/lib/api';
import { formatDay, todayIso } from '@/lib/employees';
import {
  days,
  leaveDates,
  LEAVE_STATUS_LABEL,
  LEAVE_STATUS_TONE,
  useLeaveRequests,
  useMyBalances,
  useMyHolidays,
  type Balance,
} from '@/lib/leave';
import { ApplyDialog } from './apply-dialog';
import { LeaveTabs } from './leave-tabs';

export function MyLeave({ session }: { session: SessionView }) {
  const router = useRouter();
  const year = Number(todayIso().slice(0, 4));
  const balances = useMyBalances(year);
  const [applying, setApplying] = useState(false);
  const linked = balances.data?.employee !== null;

  return (
    <>
      <PageHeader
        title="Leave"
        description="Your balances, your requests and the holidays ahead."
        actions={
          linked && balances.isSuccess ? (
            <Button onClick={() => setApplying(true)}>Apply for leave</Button>
          ) : null
        }
      />
      <LeaveTabs session={session} active="/leave" />
      {balances.isPending ? (
        <Loading />
      ) : balances.isError ? (
        <Alert tone="error">{errorMessage(balances.error)}</Alert>
      ) : !linked ? (
        <EmptyState title="Your account isn’t linked to an employee record">
          Leave needs an employee record. Ask HR to link your account to yours.
        </EmptyState>
      ) : (
        <>
          <section aria-labelledby="balances-heading" className="flex flex-col gap-3">
            <h2 id="balances-heading" className="text-[17px] font-semibold">
              Balances for {year}
            </h2>
            {balances.data.balances.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No leave types with a balance have been set up yet.
              </p>
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {balances.data.balances.map((b) => (
                  <BalanceCard key={b.leaveType.id} b={b} />
                ))}
              </ul>
            )}
          </section>
          <MyRequests />
          <UpcomingHolidays year={year} />
        </>
      )}
      {applying && (
        <ApplyDialog
          onClose={() => setApplying(false)}
          onDone={(r) => router.push(`/leave/requests/${r.id}`)}
        />
      )}
    </>
  );
}

function BalanceCard({ b }: { b: Balance }) {
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
      <span className="text-[13px] font-medium text-muted-foreground">{b.leaveType.name}</span>
      <span className="text-[28px] leading-tight font-semibold tabular-nums">{b.available}</span>
      <span className="text-xs text-muted-foreground">
        available · {days(b.balance)} balance
        {b.pending > 0 ? `, ${days(b.pending)} waiting` : ''}
      </span>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">Credited</dt>
        <dd className="text-right tabular-nums">{b.credited}</dd>
        {b.carriedForward > 0 && (
          <>
            <dt className="text-muted-foreground">Carried forward</dt>
            <dd className="text-right tabular-nums">{b.carriedForward}</dd>
          </>
        )}
        {b.adjusted !== 0 && (
          <>
            <dt className="text-muted-foreground">Adjusted</dt>
            <dd className="text-right tabular-nums">{b.adjusted}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Taken</dt>
        <dd className="text-right tabular-nums">{b.taken}</dd>
      </dl>
    </li>
  );
}

function MyRequests() {
  const requests = useLeaveRequests('mine');
  return (
    <section aria-labelledby="requests-heading" className="flex flex-col gap-3">
      <h2 id="requests-heading" className="text-[17px] font-semibold">
        My requests
      </h2>
      {requests.isPending ? (
        <Loading />
      ) : requests.isError ? (
        <Alert tone="error">{errorMessage(requests.error)}</Alert>
      ) : requests.data.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">None yet.</p>
      ) : (
        <Table label="My leave requests">
          <thead>
            <tr>
              <Th>Dates</Th>
              <Th>Type</Th>
              <Th className="text-right">Days</Th>
              <Th>Reason</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {requests.data.map((r) => (
              <tr key={r.id}>
                <Td>
                  <Link href={`/leave/requests/${r.id}`} className="text-primary hover:underline">
                    {leaveDates(r.from, r.to, r.halfDay)}
                  </Link>
                </Td>
                <Td>{r.leaveType.name}</Td>
                <Td className="text-right tabular-nums">{r.days}</Td>
                <Td>{r.reason}</Td>
                <Td>
                  <Badge tone={LEAVE_STATUS_TONE[r.status]}>{LEAVE_STATUS_LABEL[r.status]}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}

function UpcomingHolidays({ year }: { year: number }) {
  const holidays = useMyHolidays(year);
  const today = todayIso();
  const ahead = (holidays.data?.holidays ?? []).filter((h) => h.date >= today);
  return (
    <section aria-labelledby="holidays-heading" className="flex flex-col gap-3">
      <h2 id="holidays-heading" className="text-[17px] font-semibold">
        Holidays ahead
        {holidays.data?.calendar && (
          <span className="ml-2 text-[13px] font-normal text-muted-foreground">
            {holidays.data.calendar.name}
          </span>
        )}
      </h2>
      {holidays.isPending ? (
        <Loading />
      ) : holidays.isError ? (
        <Alert tone="error">{errorMessage(holidays.error)}</Alert>
      ) : ahead.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No more holidays this year.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
          {ahead.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span>
                {h.name}
                {h.optional && <span className="text-muted-foreground"> · optional</span>}
              </span>
              <span className="text-muted-foreground tabular-nums">{formatDay(h.date)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
