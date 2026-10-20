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
import { ACCOUNT_TYPE_LABEL, financeKeys, fyStart, inr, type AccountType } from '@/lib/finance';
import { FinancePage } from '../../finance-page';

interface Ledger {
  account: { id: string; code: string; name: string; type: AccountType };
  opening: number;
  closing: number;
  rows: {
    id: string;
    date: string;
    debit: number;
    credit: number;
    balance: number;
    narration: string;
    journal: { id: string; number: string | null };
  }[];
}

export default function LedgerPage() {
  const { id } = useParams<{ id: string }>();
  return <FinancePage>{() => <LedgerView id={id} />}</FinancePage>;
}

function LedgerView({ id }: { id: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(fyStart(today));
  const [to, setTo] = useState(today);
  const ledger = useQuery({
    queryKey: financeKeys.ledger(id, from, to),
    queryFn: () => apiFetch<Ledger>(`/v1/finance/accounts/${id}/ledger?from=${from}&to=${to}`),
    enabled: !!from && !!to,
  });
  return (
    <>
      <PageHeader
        title={ledger.data ? `${ledger.data.account.code} · ${ledger.data.account.name}` : 'Ledger'}
        description={
          ledger.data
            ? `${ACCOUNT_TYPE_LABEL[ledger.data.account.type]} account. Posted journals only.`
            : undefined
        }
      />
      <p>
        <Link href="/finance/accounts" className="text-sm text-primary hover:underline">
          ← Chart of accounts
        </Link>
      </p>
      <div className="flex flex-wrap gap-4">
        <Field id="ledger-from" label="From">
          <Input id="ledger-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field id="ledger-to" label="To">
          <Input id="ledger-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {ledger.isPending ? (
        <Loading />
      ) : ledger.isError ? (
        <Alert tone="error">{errorMessage(ledger.error)}</Alert>
      ) : (
        <Table label="Ledger">
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Journal</Th>
              <Th>Narration</Th>
              <Th className="text-right">Debit</Th>
              <Th className="text-right">Credit</Th>
              <Th className="text-right">Balance</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td>{from}</Td>
              <Td />
              <Td className="font-medium">Opening balance</Td>
              <Td />
              <Td />
              <Td className="text-right tabular-nums">{inr(ledger.data.opening)}</Td>
            </tr>
            {ledger.data.rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap">{r.date}</Td>
                <Td className="whitespace-nowrap">
                  <Link href={`/finance/journals/${r.journal.id}`} className="text-primary hover:underline">
                    {r.journal.number}
                  </Link>
                </Td>
                <Td>{r.narration}</Td>
                <Td className="text-right tabular-nums">{r.debit ? inr(r.debit) : ''}</Td>
                <Td className="text-right tabular-nums">{r.credit ? inr(r.credit) : ''}</Td>
                <Td className="text-right tabular-nums">{inr(r.balance)}</Td>
              </tr>
            ))}
            <tr className="font-semibold">
              <Td>{to}</Td>
              <Td />
              <Td>Closing balance</Td>
              <Td />
              <Td />
              <Td className="text-right tabular-nums">{inr(ledger.data.closing)}</Td>
            </tr>
          </tbody>
        </Table>
      )}
    </>
  );
}
