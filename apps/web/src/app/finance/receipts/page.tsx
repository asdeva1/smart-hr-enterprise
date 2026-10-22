'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { inr, useBooksCompany } from '@/lib/finance';
import { can } from '@/lib/permissions';
import { MODE_LABEL, type PaymentMode } from '@/lib/sales';
import { CompanyPicker, FinancePage, SalesTabs } from '../finance-page';
import { ReceiptDialog } from './receipt-dialog';

interface Receipt {
  id: string;
  number: string;
  date: string;
  customer: { id: string; name: string };
  amount: number;
  mode: PaymentMode;
  reference: string | null;
  allocations: { documentId: string; number: string | null; amount: number }[];
  unallocated: number;
}

export default function ReceiptsPage() {
  return (
    <FinancePage active="Payments received">
      {(session) => <Receipts canManage={can(session, 'finance.manage')} />}
    </FinancePage>
  );
}

function Receipts({ canManage }: { canManage: boolean }) {
  const [companyId, setCompanyId] = useBooksCompany();
  const [adding, setAdding] = useState(false);
  const list = useQuery({
    queryKey: ['sales', 'receipts', companyId],
    queryFn: () => apiFetch<Receipt[]>(`/v1/finance/sales/receipts?companyId=${companyId}`),
    enabled: !!companyId,
  });
  return (
    <>
      <PageHeader
        title="Payments received"
        description="Money from customers. Each one settles their oldest unpaid invoices and posts to the bank or cash book."
        actions={canManage ? <Button onClick={() => setAdding(true)}>Record payment</Button> : null}
      />
      <SalesTabs active="/finance/receipts" />
      <CompanyPicker value={companyId} onChange={setCompanyId} />
      {!companyId || list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <Alert tone="error">{errorMessage(list.error)}</Alert>
      ) : list.data.length === 0 ? (
        <EmptyState title="No payments yet">Record a payment when a customer pays you.</EmptyState>
      ) : (
        <Table label="Payments received">
          <thead>
            <tr>
              <Th>Number</Th>
              <Th>Date</Th>
              <Th>Customer</Th>
              <Th>Paid by</Th>
              <Th>Against</Th>
              <Th className="text-right">Amount</Th>
              <Th className="text-right">Unapplied</Th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((r) => (
              <tr key={r.id}>
                <Td className="font-medium whitespace-nowrap">{r.number}</Td>
                <Td className="whitespace-nowrap">{r.date}</Td>
                <Td>{r.customer.name}</Td>
                <Td>
                  {MODE_LABEL[r.mode]}
                  {r.reference ? ` · ${r.reference}` : ''}
                </Td>
                <Td>{r.allocations.map((a) => a.number).join(', ') || '—'}</Td>
                <Td className="text-right tabular-nums">{inr(r.amount)}</Td>
                <Td className="text-right tabular-nums">{r.unallocated ? inr(r.unallocated) : ''}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {adding && <ReceiptDialog companyId={companyId} onClose={() => setAdding(false)} />}
    </>
  );
}
