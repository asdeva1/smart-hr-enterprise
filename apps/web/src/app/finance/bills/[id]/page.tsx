'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { financeKeys, inr } from '@/lib/finance';
import { can } from '@/lib/permissions';
import {
  BILL_STATUS_LABEL,
  BILL_STATUS_TONE,
  BILL_TYPE_LABEL,
  purchaseKeys,
  type Bill,
} from '@/lib/purchases';
import { FinancePage } from '../../finance-page';
import { PaymentDialog } from '../../vendor-payments/payment-dialog';
import { BillEditor } from '../bill-editor';

export default function BillPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <FinancePage active="Bills and payments">
      {(session) => <BillView id={id} canManage={can(session, 'finance.manage')} />}
    </FinancePage>
  );
}

function BillView({ id, canManage }: { id: string; canManage: boolean }) {
  const router = useRouter();
  const client = useQueryClient();
  const [paying, setPaying] = useState(false);
  const q = useQuery({
    queryKey: purchaseKeys.bill(id),
    queryFn: () => apiFetch<Bill>(`/v1/finance/purchases/bills/${id}`),
  });
  const act = useMutation({
    mutationFn: (path: 'post' | 'cancel' | 'debit-note') =>
      apiFetch<Bill>(`/v1/finance/purchases/bills/${id}/${path}`, { method: 'POST' }),
    onSuccess: async (next, path) => {
      await client.invalidateQueries({ queryKey: purchaseKeys.all });
      await client.invalidateQueries({ queryKey: financeKeys.all });
      if (path === 'debit-note') router.push(`/finance/bills/${next.id}`);
      if (path === 'cancel') router.push('/finance/bills');
    },
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <Alert tone="error">{errorMessage(q.error)}</Alert>;
  const b = q.data;
  const label = BILL_TYPE_LABEL[b.type].toLowerCase();

  if (b.status === 'DRAFT' && canManage) {
    return (
      <>
        <p>
          <Link href="/finance/bills" className="text-sm text-primary hover:underline">
            ← Back to bills
          </Link>
        </p>
        <BillEditor key={b.id} companyId={b.companyId} type={b.type} existing={b} />
        <div className="flex gap-3">
          <Button disabled={act.isPending} onClick={() => act.mutate('post')}>
            Post to books
          </Button>
          <Button variant="danger" disabled={act.isPending} onClick={() => act.mutate('cancel')}>
            Discard this draft
          </Button>
        </div>
        {act.isError && <Alert tone="error">{errorMessage(act.error)}</Alert>}
      </>
    );
  }
  const open = b.type === 'BILL' && (b.status === 'POSTED' || b.status === 'PARTIALLY_PAID');
  const posted = b.status !== 'DRAFT' && b.status !== 'CANCELLED';
  return (
    <>
      <p>
        <Link href="/finance/bills" className="text-sm text-primary hover:underline">
          ← Back to bills
        </Link>
      </p>
      <PageHeader
        title={`${BILL_TYPE_LABEL[b.type]} ${b.number ?? '(draft)'}`}
        description={`${b.vendor.name}${b.vendorBillNo ? ` · their bill ${b.vendorBillNo}` : ''}`}
        actions={
          canManage ? (
            <>
              {open && <Button onClick={() => setPaying(true)}>Record payment</Button>}
              {posted && b.type === 'BILL' && (
                <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate('debit-note')}>
                  Create debit note
                </Button>
              )}
            </>
          ) : null
        }
      />
      {act.isError && <Alert tone="error">{errorMessage(act.error)}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={BILL_STATUS_TONE[b.status]}>{BILL_STATUS_LABEL[b.status]}</Badge>
        <span>Dated {b.date}</span>
        {b.dueDate && <span>Due {b.dueDate}</span>}
        {b.journalEntryId && (
          <Link href={`/finance/journals/${b.journalEntryId}`} className="text-primary hover:underline">
            See the journal
          </Link>
        )}
      </div>
      <Table label={`${label} items`}>
        <thead>
          <tr>
            <Th>Item</Th>
            <Th>Booked to</Th>
            <Th>HSN</Th>
            <Th className="text-right">Qty</Th>
            <Th className="text-right">Rate</Th>
            <Th className="text-right">GST</Th>
            <Th className="text-right">Amount</Th>
          </tr>
        </thead>
        <tbody>
          {b.lines.map((l, i) => (
            <tr key={i}>
              <Td>{l.description}</Td>
              <Td>{l.account ? `${l.account.code} · ${l.account.name}` : ''}</Td>
              <Td>{l.hsn ?? ''}</Td>
              <Td className="text-right tabular-nums">{l.quantity}</Td>
              <Td className="text-right tabular-nums">{inr(l.rate)}</Td>
              <Td className="text-right">{l.gstRate}%</Td>
              <Td className="text-right tabular-nums">{inr(l.amount)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <dl className="ml-auto w-full max-w-sm space-y-1.5 tabular-nums">
        <Sum k="Subtotal" v={b.subtotal} />
        {b.cgst > 0 && <Sum k="CGST" v={b.cgst} />}
        {b.sgst > 0 && <Sum k="SGST" v={b.sgst} />}
        {b.igst > 0 && <Sum k="IGST" v={b.igst} />}
        <Sum k="Total" v={b.total} bold />
        {b.tdsAmount > 0 && <Sum k={`TDS ${b.tdsRate}% held back`} v={-b.tdsAmount} />}
        {b.type === 'BILL' && <Sum k="Paid so far" v={b.settled} />}
        {b.type === 'BILL' && <Sum k="Still owed" v={b.outstanding} bold />}
      </dl>
      {b.note && <p className="text-muted-foreground">{b.note}</p>}
      {paying && (
        <PaymentDialog
          companyId={b.companyId}
          vendorId={b.vendor.id}
          amount={b.outstanding}
          onClose={() => setPaying(false)}
        />
      )}
    </>
  );
}

function Sum({ k, v, bold }: { k: string; v: number; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
      <dt>{k}</dt>
      <dd>₹{inr(v)}</dd>
    </div>
  );
}
