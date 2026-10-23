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
  vendor: { id: string; name: string; gstin: string | null };
  opening: number;
  closing: number;
  rows: {
    id: string;
    date: string;
    kind: 'BILL' | 'DEBIT_NOTE' | 'PAYMENT';
    number: string | null;
    billed: number;
    paid: number;
    balance: number;
  }[];
}
const KIND = { BILL: 'Bill', DEBIT_NOTE: 'Debit note', PAYMENT: 'Payment made' } as const;

export default function VendorLedgerPage() {
  const { id } = useParams<{ id: string }>();
  return <FinancePage active="Bills and payments">{() => <Ledger id={id} />}</FinancePage>;
}

function Ledger({ id }: { id: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [companyId] = useBooksCompany();
  const [from, setFrom] = useState(fyStart(today));
  const [to, setTo] = useState(today);
  const q = useQuery({
    queryKey: ['purchases', 'statement', id, companyId, from, to],
    queryFn: () =>
      apiFetch<Statement>(
        `/v1/finance/purchases/vendors/${id}/statement?companyId=${companyId}&from=${from}&to=${to}`,
      ),
    enabled: !!companyId && !!from && !!to,
  });
  return (
    <>
      <PageHeader
        title={q.data ? q.data.vendor.name : 'Vendor ledger'}
        description="Bills, debit notes and payments with a running balance. A positive balance is what you owe them."
      />
      <p>
        <Link href="/finance/payables" className="text-sm text-primary hover:underline">
          ← Payables ageing
        </Link>
      </p>
      <div className="flex flex-wrap gap-4">
        <Field id="vl-from" label="From">
          <Input id="vl-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field id="vl-to" label="To">
          <Input id="vl-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <Alert tone="error">{errorMessage(q.error)}</Alert>
      ) : (
        <Table label="Vendor ledger">
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Entry</Th>
              <Th>Number</Th>
              <Th className="text-right">Billed</Th>
              <Th className="text-right">Paid or credited</Th>
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
                  {r.kind === 'PAYMENT' ? (
                    r.number
                  ) : (
                    <Link href={`/finance/bills/${r.id}`} className="text-primary hover:underline">
                      {r.number}
                    </Link>
                  )}
                </Td>
                <Td className="text-right tabular-nums">{r.billed ? inr(r.billed) : ''}</Td>
                <Td className="text-right tabular-nums">{r.paid ? inr(r.paid) : ''}</Td>
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
