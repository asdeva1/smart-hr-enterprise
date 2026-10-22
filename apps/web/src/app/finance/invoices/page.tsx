'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { inr, useBooksCompany } from '@/lib/finance';
import { can } from '@/lib/permissions';
import {
  DOC_TYPE_LABEL,
  DOC_TYPE_PLURAL,
  STATUS_LABEL,
  STATUS_TONE,
  salesKeys,
  type SalesDocType,
  type SalesRow,
} from '@/lib/sales';
import { cn } from '@/lib/utils';
import { CompanyPicker, FinancePage, SalesTabs } from '../finance-page';

interface Summary {
  outstanding: number;
  outstandingCount: number;
  overdue: number;
  overdueCount: number;
  receivedThisMonth: number;
  receivedCount: number;
  drafts: number;
}

const FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'OPEN', label: 'Unpaid' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'PAID', label: 'Paid' },
] as const;

export default function InvoicesPage() {
  return (
    <FinancePage active="Invoices">
      {(session) => <Invoices canManage={can(session, 'finance.manage')} />}
    </FinancePage>
  );
}

function Invoices({ canManage }: { canManage: boolean }) {
  const [companyId, setCompanyId] = useBooksCompany();
  const [type, setType] = useState<SalesDocType>('INVOICE');
  const [status, setStatus] = useState<(typeof FILTERS)[number]['value']>('ALL');
  const [q, setQ] = useState('');
  const list = useQuery({
    queryKey: salesKeys.documents(companyId, type, status, q),
    queryFn: () =>
      apiFetch<SalesRow[]>(
        `/v1/finance/sales/documents?companyId=${companyId}&type=${type}&status=${status}&q=${encodeURIComponent(q)}`,
      ),
    enabled: !!companyId,
  });
  const summary = useQuery({
    queryKey: salesKeys.summary(companyId),
    queryFn: () => apiFetch<Summary>(`/v1/finance/sales/summary?companyId=${companyId}`),
    enabled: !!companyId,
  });
  const s = summary.data;
  return (
    <>
      <PageHeader
        title="Invoices"
        description="Bill your customers, track what is owed and record payments. Issued invoices post to your books."
        actions={
          canManage ? (
            <Link href={`/finance/invoices/new?type=${type}`} className={buttonVariants({})}>
              New {DOC_TYPE_LABEL[type].toLowerCase()}
            </Link>
          ) : null
        }
      />
      <SalesTabs active="/finance/invoices" />
      <CompanyPicker value={companyId} onChange={setCompanyId} />
      {s && (
        <section aria-label="Totals" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Outstanding"
            value={`₹${inr(s.outstanding)}`}
            note={`${s.outstandingCount} invoices`}
          />
          <Stat
            label="Overdue"
            value={`₹${inr(s.overdue)}`}
            note={`${s.overdueCount} past due`}
            tone={s.overdue > 0 ? 'text-danger' : undefined}
          />
          <Stat
            label="Received this month"
            value={`₹${inr(s.receivedThisMonth)}`}
            note={`${s.receivedCount} payments`}
            tone="text-success"
          />
          <Stat label="Drafts" value={String(s.drafts)} note="Not issued yet" />
        </section>
      )}
      <Tabs
        label="Document type"
        value={type}
        onChange={(v) => {
          setType(v);
          setStatus('ALL');
        }}
        options={(Object.keys(DOC_TYPE_PLURAL) as SalesDocType[]).map((v) => ({
          value: v,
          label: DOC_TYPE_PLURAL[v],
        }))}
      />
      <div className="flex flex-wrap items-end gap-4">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {FILTERS.filter((f) => type === 'INVOICE' || f.value === 'ALL' || f.value === 'DRAFT').map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={status === f.value}
              onClick={() => setStatus(f.value)}
              className={cn(
                'h-9 rounded-full border border-input px-4 text-sm font-medium',
                status === f.value ? 'border-foreground bg-foreground text-white' : 'bg-card',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="w-72 max-w-full">
          <Field id="doc-search" label="Search">
            <Input
              id="doc-search"
              type="search"
              placeholder="Number or customer"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </Field>
        </div>
      </div>
      {!companyId || list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <Alert tone="error">{errorMessage(list.error)}</Alert>
      ) : list.data.length === 0 ? (
        <EmptyState title={`No ${DOC_TYPE_PLURAL[type].toLowerCase()} yet`}>
          {canManage ? 'Create the first one with the button above.' : 'Nothing to show here.'}
        </EmptyState>
      ) : (
        <Table label={DOC_TYPE_PLURAL[type]}>
          <thead>
            <tr>
              <Th>Number</Th>
              <Th>Customer</Th>
              <Th>Date</Th>
              {type === 'INVOICE' && <Th>Due</Th>}
              <Th className="text-right">Amount</Th>
              {type === 'INVOICE' && <Th className="text-right">Owed</Th>}
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((d) => (
              <tr key={d.id}>
                <Td className="font-medium whitespace-nowrap">
                  <Link href={`/finance/invoices/${d.id}`} className="text-primary hover:underline">
                    {d.number ?? 'Draft'}
                  </Link>
                </Td>
                <Td>{d.customer.name}</Td>
                <Td className="whitespace-nowrap">{d.date}</Td>
                {type === 'INVOICE' && <Td className="whitespace-nowrap">{d.dueDate ?? '—'}</Td>}
                <Td className="text-right tabular-nums">{inr(d.total)}</Td>
                {type === 'INVOICE' && (
                  <Td className="text-right tabular-nums">{d.outstanding ? inr(d.outstanding) : ''}</Td>
                )}
                <Td>
                  <Badge tone={d.overdue ? 'danger' : STATUS_TONE[d.status]}>
                    {d.overdue ? 'Overdue' : STATUS_LABEL[d.status]}
                  </Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: string | undefined;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3.5">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className={cn('mt-1.5 text-2xl font-semibold tabular-nums', tone)}>{value}</div>
      <div className="mt-0.5 text-[13px] text-muted-foreground">{note}</div>
    </div>
  );
}
