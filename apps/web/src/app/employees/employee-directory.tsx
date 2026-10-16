'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage, useCompanies, useDepartments } from '@/lib/admin';
import type { SessionView } from '@/lib/api';
import {
  formatDay,
  PAGE_SIZE,
  STATUS_LABEL,
  STATUS_TONE,
  useEmployees,
  type EmployeeFilters,
} from '@/lib/employees';
import { can } from '@/lib/permissions';

export function EmployeeDirectory({ session }: { session: SessionView }) {
  const params = useSearchParams();
  const [filters, setFilters] = useState<EmployeeFilters>({
    search: '',
    status: 'CURRENT',
    companyId: '',
    departmentId: '',
    page: 1,
  });
  const search = useDeferredValue(filters.search.trim());
  const employees = useEmployees({ ...filters, search });
  const companies = useCompanies();
  const departments = useDepartments();
  const canManage = can(session, 'employees.manage');
  const set = (patch: Partial<EmployeeFilters>) => setFilters((f) => ({ ...f, page: 1, ...patch }));
  const totalPages = employees.data ? Math.max(1, Math.ceil(employees.data.total / PAGE_SIZE)) : 1;
  const imported = params.get('imported');

  return (
    <>
      <PageHeader
        title="Employees"
        description="Everyone employed by your companies. You see the people in your part of the organisation."
        actions={
          <span className="flex flex-wrap gap-2">
            <Link href="/employees/org-chart" className={buttonVariants({ variant: 'outline' })}>
              Organisation chart
            </Link>
            {canManage && (
              <>
                <Link href="/employees/import" className={buttonVariants({ variant: 'outline' })}>
                  Import
                </Link>
                <Link href="/employees/new" className={buttonVariants()}>
                  Add employee
                </Link>
              </>
            )}
          </span>
        }
      />
      {imported && <Alert tone="success">Imported {imported} employees.</Alert>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-[2_1_240px] flex-col gap-1.5">
          <span className="text-[13px] font-medium">Search</span>
          <Input
            type="search"
            placeholder="Name, employee number or email"
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
          />
        </label>
        <label className="flex min-w-0 flex-[1_1_150px] flex-col gap-1.5">
          <span className="text-[13px] font-medium">Status</span>
          <Select
            value={filters.status}
            onChange={(e) => set({ status: e.target.value as EmployeeFilters['status'] })}
          >
            <option value="CURRENT">Current (active and on notice)</option>
            <option value="ACTIVE">Active</option>
            <option value="ON_NOTICE">On notice</option>
            <option value="EXITED">Left</option>
            <option value="ALL">Everyone</option>
          </Select>
        </label>
        <label className="flex min-w-0 flex-[1_1_170px] flex-col gap-1.5">
          <span className="text-[13px] font-medium">Company</span>
          <Select
            value={filters.companyId}
            onChange={(e) => set({ companyId: e.target.value, departmentId: '' })}
          >
            <option value="">All companies</option>
            {companies.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex min-w-0 flex-[1_1_170px] flex-col gap-1.5">
          <span className="text-[13px] font-medium">Department</span>
          <Select value={filters.departmentId} onChange={(e) => set({ departmentId: e.target.value })}>
            <option value="">All departments</option>
            {departments.data
              ?.filter((d) => !filters.companyId || d.companyId === filters.companyId)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </Select>
        </label>
      </div>
      {employees.isPending ? (
        <Loading />
      ) : employees.isError ? (
        <Alert tone="error">{errorMessage(employees.error)}</Alert>
      ) : employees.data.items.length === 0 ? (
        <EmptyState title={search ? 'Nobody matches that search' : 'No employees here yet'}>
          {canManage && !search && 'Add employees one by one, or import a spreadsheet of everyone at once.'}
        </EmptyState>
      ) : (
        <>
          <Table label="Employees">
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Designation</Th>
                <Th>Department</Th>
                <Th>Location</Th>
                <Th>Manager</Th>
                <Th>Joined</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {employees.data.items.map((e) => (
                <tr key={e.id}>
                  <Td>
                    <Link
                      href={`/employees/${e.id}`}
                      className="font-semibold hover:text-primary hover:underline"
                    >
                      {e.name}
                    </Link>
                    <div className="font-mono text-xs text-muted-foreground">{e.employeeCode}</div>
                  </Td>
                  <Td>{e.designation?.name ?? <span className="text-muted-foreground">—</span>}</Td>
                  <Td>{e.department?.name ?? <span className="text-muted-foreground">—</span>}</Td>
                  <Td>
                    {e.branch?.name ?? <span className="text-muted-foreground">—</span>}
                    <div className="text-xs text-muted-foreground">{e.company.name}</div>
                  </Td>
                  <Td>{e.manager?.name ?? <span className="text-muted-foreground">—</span>}</Td>
                  <Td className="whitespace-nowrap tabular-nums">{formatDay(e.dateOfJoining)}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
                    {e.status === 'ON_NOTICE' && (
                      <div className="text-xs text-muted-foreground">Until {formatDay(e.lastWorkingDay)}</div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-muted-foreground">
              {employees.data.total} {employees.data.total === 1 ? 'employee' : 'employees'} · page{' '}
              {filters.page} of {totalPages}
            </span>
            <span className="flex gap-2">
              <Button
                variant="outline"
                disabled={filters.page <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                disabled={filters.page >= totalPages}
                onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
              >
                Next
              </Button>
            </span>
          </nav>
        </>
      )}
    </>
  );
}
