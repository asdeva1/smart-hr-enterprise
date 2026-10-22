'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { fyStart, inr, useAccounts, useBooksCompany } from '@/lib/finance';
import { CompanyPicker, FinancePage, FinanceTabs } from '../finance-page';

interface DayBook {
  rows: {
    id: string;
    number: string | null;
    date: string;
    narration: string;
    total: number;
    lines: { id: string; account: string; debit: number; credit: number; narration: string | null }[];
  }[];
  total: number;
}
interface CashBook {
  books: {
    account: { id: string; code: string; name: string };
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
  }[];
}

const VIEWS = {
  'day-book': 'Day book',
  cash: 'Cash book',
  bank: 'Bank book',
  ledger: 'General ledger',
} as const;
type View = keyof typeof VIEWS;

export default function BooksOfAccountsPage() {
  return <FinancePage active="Books of accounts">{(session) => <Books session={session} />}</FinancePage>;
}

function Books({ session }: { session: Parameters<typeof FinanceTabs>[0]['session'] }) {
  const today = new Date().toISOString().slice(0, 10);
  const router = useRouter();
  const [companyId, setCompanyId] = useBooksCompany();
  const [view, setView] = useState<View>('day-book');
  const [from, setFrom] = useState(fyStart(today));
  const [to, setTo] = useState(today);
  const accounts = useAccounts(companyId);
  return (
    <>
      <PageHeader
        title="Books of accounts"
        description="The day book, cash book, bank book and general ledger, from posted journals only."
      />
      <FinanceTabs session={session} active="/finance/books-of-accounts" />
      <div className="flex flex-wrap items-end gap-4">
        <CompanyPicker value={companyId} onChange={setCompanyId} />
        <Field id="book-view" label="Book">
          <Select id="book-view" value={view} onChange={(e) => setView(e.target.value as View)}>
            {Object.entries(VIEWS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        {view !== 'ledger' && (
          <>
            <Field id="book-from" label="From">
              <Input id="book-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field id="book-to" label="To">
              <Input id="book-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </>
        )}
      </div>
      {!companyId ? (
        <Loading />
      ) : view === 'day-book' ? (
        <DayBookView companyId={companyId} from={from} to={to} />
      ) : view === 'ledger' ? (
        <div className="max-w-md">
          <Field id="book-account" label="Open the ledger of an account">
            <Select
              id="book-account"
              defaultValue=""
              onChange={(e) => e.target.value && router.push(`/finance/accounts/${e.target.value}`)}
            >
              <option value="">Choose an account</option>
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <p className="mt-3 text-sm text-muted-foreground">
            For all balances at once, see the{' '}
            <Link href="/finance/reports" className="text-primary hover:underline">
              trial balance
            </Link>
            .
          </p>
        </div>
      ) : (
        <CashBookView companyId={companyId} from={from} to={to} kind={view === 'cash' ? 'CASH' : 'BANK'} />
      )}
    </>
  );
}

function DayBookView({ companyId, from, to }: { companyId: string; from: string; to: string }) {
  const q = useQuery({
    queryKey: ['finance', 'day-book', companyId, from, to],
    queryFn: () =>
      apiFetch<DayBook>(
        `/v1/finance/books-of-accounts/day-book?companyId=${companyId}&from=${from}&to=${to}`,
      ),
    enabled: !!from && !!to,
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <Alert tone="error">{errorMessage(q.error)}</Alert>;
  return (
    <Table label="Day book">
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>Journal</Th>
          <Th>Account and narration</Th>
          <Th className="text-right">Debit</Th>
          <Th className="text-right">Credit</Th>
        </tr>
      </thead>
      <tbody>
        {q.data.rows.length === 0 && (
          <tr>
            <Td colSpan={5} className="text-muted-foreground">
              Nothing posted in this period.
            </Td>
          </tr>
        )}
        {q.data.rows.map((e) => (
          <Fragment key={e.id}>
            <tr className="bg-muted/40">
              <Td className="whitespace-nowrap font-medium">{e.date}</Td>
              <Td className="whitespace-nowrap">
                <Link href={`/finance/journals/${e.id}`} className="text-primary hover:underline">
                  {e.number}
                </Link>
              </Td>
              <Td colSpan={3} className="font-medium">
                {e.narration}
              </Td>
            </tr>
            {e.lines.map((l) => (
              <tr key={l.id}>
                <Td />
                <Td />
                <Td className={l.credit ? 'pl-8' : ''}>{l.account}</Td>
                <Td className="text-right tabular-nums">{l.debit ? inr(l.debit) : ''}</Td>
                <Td className="text-right tabular-nums">{l.credit ? inr(l.credit) : ''}</Td>
              </tr>
            ))}
          </Fragment>
        ))}
        <tr className="font-semibold">
          <Td colSpan={3}>Total</Td>
          <Td className="text-right tabular-nums">{inr(q.data.total)}</Td>
          <Td className="text-right tabular-nums">{inr(q.data.total)}</Td>
        </tr>
      </tbody>
    </Table>
  );
}

function CashBookView({
  companyId,
  from,
  to,
  kind,
}: {
  companyId: string;
  from: string;
  to: string;
  kind: 'CASH' | 'BANK';
}) {
  const q = useQuery({
    queryKey: ['finance', 'cash-book', kind, companyId, from, to],
    queryFn: () =>
      apiFetch<CashBook>(
        `/v1/finance/books-of-accounts/cash-book?companyId=${companyId}&from=${from}&to=${to}&kind=${kind}`,
      ),
    enabled: !!from && !!to,
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <Alert tone="error">{errorMessage(q.error)}</Alert>;
  if (q.data.books.length === 0) {
    return (
      <Alert tone="info">No {kind === 'CASH' ? 'cash' : 'bank'} account is set up for this company.</Alert>
    );
  }
  return (
    <>
      {q.data.books.map((b) => (
        <Table key={b.account.id} label={`${b.account.name} book`}>
          <thead>
            <tr>
              <Th colSpan={6}>
                {b.account.code} · {b.account.name}
              </Th>
            </tr>
            <tr>
              <Th>Date</Th>
              <Th>Journal</Th>
              <Th>Narration</Th>
              <Th className="text-right">Received</Th>
              <Th className="text-right">Paid</Th>
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
              <Td className="text-right tabular-nums">{inr(b.opening)}</Td>
            </tr>
            {b.rows.map((r) => (
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
              <Td className="text-right tabular-nums">{inr(b.closing)}</Td>
            </tr>
          </tbody>
        </Table>
      ))}
    </>
  );
}
