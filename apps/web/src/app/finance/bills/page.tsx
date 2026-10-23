'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
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
  BILL_STATUS_LABEL,
  BILL_STATUS_TONE,
  purchaseKeys,
  type BillRow,
  type BillType,
} from '@/lib/purchases';
import { cn } from '@/lib/utils';
import { CompanyPicker, FinancePage, PurchasesTabs } from '../finance-page';
import { PaymentDialog } from '../vendor-payments/payment-dialog';

interface Summary {
  outstanding: number;
  outstandingCount: number;
  overdue: number;
  overdueCount: number;
  dueThisWeek: number;
  paidThisMonth: number;
  paidCount: number;
  drafts: number;
}
const FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'OPEN', label: 'Unpaid' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'PAID', label: 'Paid' },
] as const;

export default function BillsPage() {
  return (
    <FinancePage active="Bills and payments">
      {(session) => <Bills canManage={can(session, 'finance.manage')} />}
    </FinancePage>
  );
}

function Bills({ canManage }: { canManage: boolean }) {
  const [companyId, setCompanyId] = useBooksCompany();
  const [type, setType] = useState<BillType>('BILL');
  const [status, setStatus] = useState<(typeof FILTERS)[number]['value']>('ALL');
  const [q, setQ] = useState('');
  const [paying, setPaying] = useState(false);
  const list = useQuery({
    queryKey: purchaseKeys.bills(companyId, type, status, q),
    queryFn: () =>
      apiFetch<BillRow[]>(
        `/v1/finance/purchases/bills?companyId=${companyId}&type=${type}&status=${status}&q=${encodeURIComponent(q)}`,
      ),
    enabled: !!companyId,
  });
  const summary = useQuery({
    queryKey: purchaseKeys.summary(companyId),
    queryFn: () => apiFetch<Summary>(`/v1/finance/purchases/summary?companyId=${companyId}`),
    enabled: !!companyId,
  });
  const s = summary.data;
  return (
    <>
      <PageHeader
        title="Bills and payments"
        description="What you owe your vendors, and the payments you have made. Posted bills go to your books."
        actions={
          canManage ? (
            <>
              <Button variant="outline" onClick={() => setPaying(true)}>
                Record payment
              </Button>
              <Link href={`/finance/bills/new?type=${type}`} className={buttonVariants({})}>
                New {type === 'BILL' ? 'bill' : 'debit note'}
              </Link>
            </>
          ) : null
        }
      />
      <PurchasesTabs active="/finance/bills" />
      <CompanyPicker value={companyId} onChange={setCompanyId} />
      {s && (
        <section aria-label="Totals" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="You owe" value={`₹${inr(s.outstanding)}`} note={`${s.outstandingCount} bills`} />
          <Stat
            label="Overdue"
            value={`₹${inr(s.overdue)}`}
            note={`${s.overdueCount} past due`}
            tone={s.overdue > 0 ? 'text-danger' : undefined}
          />
          <Stat label="Due in 7 days" value={`₹${inr(s.dueThisWeek)}`} note="Plan these payments" />
          <Stat
            label="Paid this month"
            value={`₹${inr(s.paidThisMonth)}`}
            note={`${s.paidCount} payments`}
            tone="text-success"
          />
        </section>
      )}
      <Tabs
        label="Document type"
        value={type}
        onChange={(v) => {
          setType(v);
          setStatus('ALL');
        }}
        options={[
          { value: 'BILL', label: 'Bills' },
          { value: 'DEBIT_NOTE', label: 'Debit notes' },
        ]}
      />
      <div className="flex flex-wrap items-end gap-4">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {FILTERS.filter((f) => type === 'BILL' || f.value === 'ALL' || f.value === 'DRAFT').map((f) => (
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
          <Field id="bill-search" label="Search">
            <Input
              id="bill-search"
              type="search"
              placeholder="Number or vendor"
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
        <EmptyState title={`No ${type === 'BILL' ? 'bills' : 'debit notes'} yet`}>
          {canManage ? 'Enter the first one with the button above.' : 'Nothing to show here.'}
        </EmptyState>
      ) : (
        <Table label={type === 'BILL' ? 'Bills' : 'Debit notes'}>
          <thead>
            <tr>
              <Th>Vendor</Th>
              <Th>Bill</Th>
              <Th>Date</Th>
              {type === 'BILL' && <Th>Due</Th>}
              <Th className="text-right">Amount</Th>
              {type === 'BILL' && <Th className="text-right">Owed</Th>}
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((b) => (
              <tr key={b.id}>
                <Td className="font-medium">{b.vendor.name}</Td>
                <Td className="whitespace-nowrap">
                  <Link href={`/finance/bills/${b.id}`} className="text-primary hover:underline">
                    {b.number ?? 'Draft'}
                  </Link>
                  {b.vendorBillNo && <span className="text-muted-foreground"> · {b.vendorBillNo}</span>}
                </Td>
                <Td className="whitespace-nowrap">{b.date}</Td>
                {type === 'BILL' && <Td className="whitespace-nowrap">{b.dueDate ?? '—'}</Td>}
                <Td className="text-right tabular-nums">{inr(b.total)}</Td>
                {type === 'BILL' && (
                  <Td className="text-right tabular-nums">{b.outstanding ? inr(b.outstanding) : ''}</Td>
                )}
                <Td>
                  <Badge tone={b.overdue ? 'danger' : BILL_STATUS_TONE[b.status]}>
                    {b.overdue ? 'Overdue' : BILL_STATUS_LABEL[b.status]}
                  </Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {paying && <PaymentDialog companyId={companyId} onClose={() => setPaying(false)} />}
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
