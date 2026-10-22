'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { fyStart, inr, useBooksCompany } from '@/lib/finance';
import { FinancePage } from '../../finance-page';

interface Statement {
  customer: { id: string; name: string; gstin: string | null };
  opening: number;
  closing: number;
  rows: {
    id: string;
    date: string;
    kind: 'INVOICE' | 'CREDIT_NOTE' | 'RECEIPT';
    number: string | null;
    debit: number;
    credit: number;
    balance: number;
  }[];
}
const KIND = { INVOICE: 'Invoice', CREDIT_NOTE: 'Credit note', RECEIPT: 'Payment received' } as const;

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  return <FinancePage active="Customers">{() => <Ledger id={id} />}</FinancePage>;
}

function Ledger({ id }: { id: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [companyId] = useBooksCompany();
  const [from, setFrom] = useState(fyStart(today));
  const [to, setTo] = useState(today);
  const q = useQuery({
    queryKey: ['sales', 'statement', id, companyId, from, to],
    queryFn: () =>
      apiFetch<Statement>(
        `/v1/finance/sales/customers/${id}/statement?companyId=${companyId}&from=${from}&to=${to}`,
      ),
    enabled: !!companyId && !!from && !!to,
  });
  return (
    <>
      <PageHeader
        title={q.data ? q.data.customer.name : 'Customer statement'}
        description="Invoices, credit notes and payments with a running balance. A positive balance is what they owe you."
        actions={null}
      />
      <p>
        <Link href="/finance/customers" className="text-sm text-primary hover:underline">
          ← Customers
        </Link>
      </p>
      <div className="flex flex-wrap gap-4">
        <Field id="st-from" label="From">
          <Input id="st-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field id="st-to" label="To">
          <Input id="st-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <Alert tone="error">{errorMessage(q.error)}</Alert>
      ) : (
        <Table label="Customer statement">
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Entry</Th>
              <Th>Number</Th>
              <Th className="text-right">Billed</Th>
              <Th className="text-right">Received or credited</Th>
              <Th className="text-right">Balance</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td>{from}</Td>
              <Td className="font-medium">Opening balance</Td>
              <Td />
              <Td />
              <Td />
              <Td className="text-right tabular-nums">{inr(q.data.opening)}</Td>
            </tr>
            {q.data.rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap">{r.date}</Td>
                <Td>{KIND[r.kind]}</Td>
                <Td className="whitespace-nowrap">
                  {r.kind === 'RECEIPT' ? (
                    r.number
                  ) : (
                    <Link href={`/finance/invoices/${r.id}`} className="text-primary hover:underline">
                      {r.number}
                    </Link>
                  )}
                </Td>
                <Td className="text-right tabular-nums">{r.debit ? inr(r.debit) : ''}</Td>
                <Td className="text-right tabular-nums">{r.credit ? inr(r.credit) : ''}</Td>
                <Td className="text-right tabular-nums">{inr(r.balance)}</Td>
              </tr>
            ))}
            <tr className="font-semibold">
              <Td>{to}</Td>
              <Td>Closing balance</Td>
              <Td />
              <Td />
              <Td />
              <Td className="text-right tabular-nums">{inr(q.data.closing)}</Td>
            </tr>
          </tbody>
        </Table>
      )}
    </>
  );
}
