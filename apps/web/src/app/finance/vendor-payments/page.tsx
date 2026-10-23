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
import type { VendorPaymentRow } from '@/lib/purchases';
import { MODE_LABEL } from '@/lib/sales';
import { CompanyPicker, FinancePage, PurchasesTabs } from '../finance-page';
import { PaymentDialog } from './payment-dialog';

export default function VendorPaymentsPage() {
  return (
    <FinancePage active="Bills and payments">
      {(session) => <Payments canManage={can(session, 'finance.manage')} />}
    </FinancePage>
  );
}

function Payments({ canManage }: { canManage: boolean }) {
  const [companyId, setCompanyId] = useBooksCompany();
  const [adding, setAdding] = useState(false);
  const list = useQuery({
    queryKey: ['purchases', 'payments', companyId],
    queryFn: () => apiFetch<VendorPaymentRow[]>(`/v1/finance/purchases/payments?companyId=${companyId}`),
    enabled: !!companyId,
  });
  return (
    <>
      <PageHeader
        title="Payments made"
        description="Money paid to vendors. Each one settles their oldest unpaid bills and posts to the bank or cash book."
        actions={canManage ? <Button onClick={() => setAdding(true)}>Record payment</Button> : null}
      />
      <PurchasesTabs active="/finance/vendor-payments" />
      <CompanyPicker value={companyId} onChange={setCompanyId} />
      {!companyId || list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <Alert tone="error">{errorMessage(list.error)}</Alert>
      ) : list.data.length === 0 ? (
        <EmptyState title="No payments yet">Record a payment when you pay a vendor.</EmptyState>
      ) : (
        <Table label="Payments made">
          <thead>
            <tr>
              <Th>Number</Th>
              <Th>Date</Th>
              <Th>Vendor</Th>
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
                <Td>{r.vendor.name}</Td>
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
      {adding && <PaymentDialog companyId={companyId} onClose={() => setAdding(false)} />}
    </>
  );
}
