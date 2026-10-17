'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import { todayIso } from '@/lib/employees';
import { leaveKeys } from '@/lib/leave';
import { can } from '@/lib/permissions';
import { LeaveTabs } from '../leave-tabs';

interface BalancesPage {
  total: number;
  page: number;
  pageSize: number;
  types: { id: string; code: string; name: string }[];
  rows: {
    employee: { id: string; name: string; employeeCode: string; department: string | null };
    balances: { leaveTypeId: string; balance: number; available: number }[];
  }[];
}

const PAGE_SIZE = 50;

export function Balances({ session }: { session: SessionView }) {
  const client = useQueryClient();
  const thisYear = Number(todayIso().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string>();
  const params = new URLSearchParams({ year: String(year), page: String(page), pageSize: String(PAGE_SIZE) });
  if (search.trim()) params.set('search', search.trim());
  const balances = useQuery({
    queryKey: leaveKeys.balances({ year, search, page }),
    queryFn: () => apiFetch<BalancesPage>(`/v1/leave/balances?${params.toString()}`),
    placeholderData: keepPreviousData,
  });
  const allocate = useMutation({
    mutationFn: () =>
      apiFetch<{ employees: number; entries: number }>('/v1/leave/allocations', {
        method: 'POST',
        body: { year },
      }),
    onSuccess: async (r) => {
      setNotice(
        r.entries === 0
          ? 'Everyone’s balances were already up to date.'
          : `Brought ${r.employees} people up to date (${r.entries} credits).`,
      );
      await client.invalidateQueries({ queryKey: ['leave'] });
    },
  });
  const pages = balances.data ? Math.max(1, Math.ceil(balances.data.total / PAGE_SIZE)) : 1;
  // Needs leave.manage for the whole organisation; the API refuses narrower holders.
  const canAllocate = can(session, 'leave.manage');

  return (
    <>
      <PageHeader
        title="Leave"
        description="Balances for everyone you can see. Credits are added automatically as the year goes on."
        actions={
          canAllocate ? (
            <Button variant="outline" disabled={allocate.isPending} onClick={() => allocate.mutate()}>
              Bring balances up to date
            </Button>
          ) : null
        }
      />
      <LeaveTabs session={session} active="/leave/balances" />
      {notice && <Alert tone="success">{notice}</Alert>}
      {allocate.isError && <Alert tone="error">{errorMessage(allocate.error)}</Alert>}
      <div className="flex flex-wrap items-end gap-3">
        <Field id="balances-year" label="Year">
          <Select
            id="balances-year"
            value={year}
            onChange={(e) => {
              setYear(Number(e.target.value));
              setPage(1);
            }}
          >
            {[thisYear, thisYear - 1].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="balances-search" label="Find">
          <Input
            id="balances-search"
            placeholder="Name or code"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </Field>
      </div>
      {balances.isPending ? (
        <Loading />
      ) : balances.isError ? (
        <Alert tone="error">{errorMessage(balances.error)}</Alert>
      ) : balances.data.rows.length === 0 ? (
        <EmptyState title="Nobody to show">
          Nobody reports to you, and you don’t look after leave for any part of the organisation.
        </EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table aria-label={`Leave balances for ${year}`} className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Employee
                  </th>
                  {balances.data.types.map((t) => (
                    <th key={t.id} scope="col" className="px-4 py-2.5 text-right font-medium" title={t.name}>
                      {t.code}
                      <span className="sr-only"> ({t.name}) available</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {balances.data.rows.map((r) => (
                  <tr key={r.employee.id} className="border-b border-border last:border-0">
                    <th scope="row" className="px-4 py-2.5 text-left font-normal">
                      <Link
                        href={`/leave/balances/${r.employee.id}?year=${year}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {r.employee.name}
                      </Link>{' '}
                      <span className="text-muted-foreground">
                        {r.employee.employeeCode}
                        {r.employee.department ? ` · ${r.employee.department}` : ''}
                      </span>
                    </th>
                    {balances.data.types.map((t) => {
                      const b = r.balances.find((x) => x.leaveTypeId === t.id);
                      return (
                        <td
                          key={t.id}
                          className={`px-4 py-2.5 text-right tabular-nums ${b && b.available < 0 ? 'text-danger' : ''}`}
                        >
                          {b ? b.available : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Days available: balance less leave waiting for approval.
          </p>
          {pages > 1 && (
            <div className="flex items-center gap-2 text-[13px]">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span>
                Page {page} of {pages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
