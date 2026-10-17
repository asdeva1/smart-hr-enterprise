'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { errorMessage, useDepartments } from '@/lib/admin';
import { ApiError, apiFetch, type SessionView } from '@/lib/api';
import {
  attendanceKeys,
  DAY_CODE,
  DAY_LABEL,
  hoursAndMinutes,
  monthLabel,
  shiftMonth,
  type DayStatus,
  type Register,
} from '@/lib/attendance';
import { todayIso } from '@/lib/employees';
import { cn } from '@/lib/utils';
import { AttendanceTabs } from '../attendance-tabs';

const PAGE_SIZE = 50;
const CELL: Record<DayStatus, string> = {
  PRESENT: 'text-success',
  HALF_DAY: 'bg-warning-soft text-warning',
  ABSENT: 'bg-danger-soft text-danger',
  WEEKLY_OFF: 'bg-muted text-muted-foreground',
  HOLIDAY: 'bg-muted text-muted-foreground',
  ON_LEAVE: 'bg-info-soft text-info',
};

/** The month as a muster roll: one row per person, one letter per day, totals at the end. */
export function AttendanceRegister({ session }: { session: SessionView }) {
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [departmentId, setDepartmentId] = useState('');
  const [page, setPage] = useState(1);
  const departments = useDepartments();
  const params = new URLSearchParams({ month, page: String(page), pageSize: String(PAGE_SIZE) });
  if (departmentId) params.set('departmentId', departmentId);
  const register = useQuery({
    queryKey: attendanceKeys.register({ month, departmentId, page }),
    queryFn: () => apiFetch<Register>(`/v1/attendance/register?${params.toString()}`),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const forbidden = register.error instanceof ApiError && register.error.status === 403;
  const pages = register.data ? Math.max(1, Math.ceil(register.data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader title="Attendance" description="The month for everyone you can see, as a register." />
      <AttendanceTabs session={session} active="/attendance/register" />
      {forbidden ? (
        <EmptyState title="No team to show">
          Nobody reports to you, and you don’t have access to attendance for any part of the organisation.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setMonth(shiftMonth(month, -1));
                  setPage(1);
                }}
              >
                Previous<span className="sr-only"> month</span>
              </Button>
              <span className="min-w-[140px] text-center font-semibold" aria-live="polite">
                {monthLabel(month)}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={month >= todayIso().slice(0, 7)}
                onClick={() => {
                  setMonth(shiftMonth(month, 1));
                  setPage(1);
                }}
              >
                Next<span className="sr-only"> month</span>
              </Button>
            </div>
            <Field id="register-department" label="Department">
              <Select
                id="register-department"
                value={departmentId}
                onChange={(e) => {
                  setDepartmentId(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All</option>
                {(departments.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="text-[13px] text-muted-foreground">
            {(Object.keys(DAY_CODE) as DayStatus[])
              .map((s) => `${DAY_CODE[s]} ${DAY_LABEL[s].toLowerCase()}`)
              .join(' · ')}{' '}
            · underline: late · blank: not yet, or not employed
          </p>
          {register.isPending ? (
            <Loading />
          ) : register.isError ? (
            <Alert tone="error">{errorMessage(register.error)}</Alert>
          ) : register.data.rows.length === 0 ? (
            <EmptyState title="Nobody to show">There is nobody in this part of the organisation.</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full border-collapse text-[12px]">
                <caption className="sr-only">Attendance register for {monthLabel(month)}</caption>
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="sticky left-0 bg-card px-3 py-2 text-left font-semibold">
                      Employee
                    </th>
                    {register.data.dates.map((d) => (
                      <th
                        key={d}
                        scope="col"
                        className="w-7 px-0.5 py-2 text-center font-medium text-muted-foreground tabular-nums"
                      >
                        {Number(d.slice(8))}
                      </th>
                    ))}
                    <th scope="col" className="px-2 py-2 text-right">
                      P
                    </th>
                    <th scope="col" className="px-2 py-2 text-right">
                      H
                    </th>
                    <th scope="col" className="px-2 py-2 text-right">
                      A
                    </th>
                    <th scope="col" className="px-2 py-2 text-right">
                      L
                    </th>
                    <th scope="col" className="px-2 py-2 text-right">
                      Late
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Overtime
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {register.data.rows.map((r) => (
                    <tr key={r.employee.id} className="border-b border-border last:border-0">
                      <th
                        scope="row"
                        className="sticky left-0 bg-card px-3 py-1.5 text-left font-normal whitespace-nowrap"
                      >
                        <span className="font-medium">{r.employee.name}</span>{' '}
                        <span className="text-muted-foreground">{r.employee.employeeCode}</span>
                      </th>
                      {r.days.map((d) => (
                        <td
                          key={d.date}
                          title={
                            d.status ? `${d.date}: ${DAY_LABEL[d.status]}${d.late ? ', late' : ''}` : d.date
                          }
                          className={cn(
                            'h-7 px-0.5 text-center font-semibold',
                            d.status && CELL[d.status],
                            d.late && 'underline decoration-2 underline-offset-2',
                          )}
                        >
                          {d.status ? DAY_CODE[d.status] : ''}
                        </td>
                      ))}
                      <td className="px-2 text-right tabular-nums">{r.totals.present}</td>
                      <td className="px-2 text-right tabular-nums">{r.totals.halfDay}</td>
                      <td className="px-2 text-right tabular-nums">{r.totals.absent}</td>
                      <td className="px-2 text-right tabular-nums">{r.totals.onLeave}</td>
                      <td className="px-2 text-right tabular-nums">{r.totals.late}</td>
                      <td className="px-3 text-right tabular-nums">
                        {hoursAndMinutes(r.totals.overtimeMinutes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 text-[13px]">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous page
              </Button>
              <span className="tabular-nums">
                Page {page} of {pages}
              </span>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next page
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
