'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { financeKeys, fyStart, inr, useBooksCompany } from '@/lib/finance';
import { CompanyPicker, FinancePage, FinanceTabs } from '../finance-page';

interface Item {
  id: string;
  code: string;
  name: string;
  amount: number;
}
interface Section {
  items: Item[];
  total: number;
}
interface TrialBalance {
  rows: { id: string; code: string; name: string; debit: number; credit: number }[];
  debit: number;
  credit: number;
}
interface ProfitAndLoss {
  income: Section;
  expenses: Section;
  profit: number;
}
interface BalanceSheet {
  assets: Section;
  liabilities: Section;
  equity: Section & { currentEarnings: number };
  balanced: boolean;
}

const REPORTS = {
  'trial-balance': 'Trial balance',
  'profit-and-loss': 'Profit and loss',
  'balance-sheet': 'Balance sheet',
} as const;
type Kind = keyof typeof REPORTS;

export default function ReportsPage() {
  return <FinancePage>{(session) => <Reports session={session} />}</FinancePage>;
}

function Reports({ session }: { session: Parameters<typeof FinanceTabs>[0]['session'] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [companyId, setCompanyId] = useBooksCompany();
  const [kind, setKind] = useState<Kind>('trial-balance');
  const [from, setFrom] = useState(fyStart(today));
  const [to, setTo] = useState(today);
  const report = useQuery({
    queryKey: financeKeys.report(kind, companyId, kind === 'profit-and-loss' ? from : '', to),
    queryFn: () =>
      apiFetch<unknown>(
        `/v1/finance/reports/${kind}?companyId=${companyId}&to=${to}${kind === 'profit-and-loss' ? `&from=${from}` : ''}`,
      ),
    enabled: !!companyId && !!to,
  });
  return (
    <>
      <PageHeader
        title="Reports"
        description="Built from posted journals only. Drafts and journals waiting for approval aren’t included."
      />
      <FinanceTabs session={session} active="/finance/reports" />
      <div className="flex flex-wrap items-end gap-4">
        <CompanyPicker value={companyId} onChange={setCompanyId} />
        <Field id="report-kind" label="Report">
          <Select id="report-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {Object.entries(REPORTS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        {kind === 'profit-and-loss' && (
          <Field id="report-from" label="From">
            <Input id="report-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
        )}
        <Field id="report-to" label={kind === 'profit-and-loss' ? 'To' : 'As at'}>
          <Input id="report-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {!companyId || report.isPending ? (
        <Loading />
      ) : report.isError ? (
        <Alert tone="error">{errorMessage(report.error)}</Alert>
      ) : kind === 'trial-balance' ? (
        <TrialBalanceView data={report.data as TrialBalance} />
      ) : kind === 'profit-and-loss' ? (
        <ProfitAndLossView data={report.data as ProfitAndLoss} />
      ) : (
        <BalanceSheetView data={report.data as BalanceSheet} />
      )}
    </>
  );
}

function TrialBalanceView({ data }: { data: TrialBalance }) {
  return (
    <Table label="Trial balance">
      <thead>
        <tr>
          <Th>Code</Th>
          <Th>Account</Th>
          <Th className="text-right">Debit</Th>
          <Th className="text-right">Credit</Th>
        </tr>
      </thead>
      <tbody>
        {data.rows.length === 0 && (
          <tr>
            <Td colSpan={4} className="text-muted-foreground">
              Nothing posted yet.
            </Td>
          </tr>
        )}
        {data.rows.map((r) => (
          <tr key={r.id}>
            <Td className="tabular-nums">{r.code}</Td>
            <Td>{r.name}</Td>
            <Td className="text-right tabular-nums">{r.debit ? inr(r.debit) : ''}</Td>
            <Td className="text-right tabular-nums">{r.credit ? inr(r.credit) : ''}</Td>
          </tr>
        ))}
        <tr className="font-semibold">
          <Td />
          <Td>Total</Td>
          <Td className="text-right tabular-nums">{inr(data.debit)}</Td>
          <Td className="text-right tabular-nums">{inr(data.credit)}</Td>
        </tr>
      </tbody>
    </Table>
  );
}

function SectionRows({
  title,
  section,
  extra,
}: {
  title: string;
  section: Section;
  extra?: { label: string; amount: number };
}) {
  return (
    <>
      <tr>
        <Th colSpan={2} scope="colgroup" className="bg-muted">
          {title}
        </Th>
      </tr>
      {section.items.map((i) => (
        <tr key={i.id}>
          <Td>
            {i.code} · {i.name}
          </Td>
          <Td className="text-right tabular-nums">{inr(i.amount)}</Td>
        </tr>
      ))}
      {extra && (
        <tr>
          <Td>{extra.label}</Td>
          <Td className="text-right tabular-nums">{inr(extra.amount)}</Td>
        </tr>
      )}
      <tr className="font-semibold">
        <Td>Total {title.toLowerCase()}</Td>
        <Td className="text-right tabular-nums">{inr(section.total)}</Td>
      </tr>
    </>
  );
}

function ProfitAndLossView({ data }: { data: ProfitAndLoss }) {
  return (
    <Table label="Profit and loss">
      <thead>
        <tr>
          <Th>Account</Th>
          <Th className="text-right">Amount</Th>
        </tr>
      </thead>
      <tbody>
        <SectionRows title="Income" section={data.income} />
        <SectionRows title="Expenses" section={data.expenses} />
        <tr className="text-base font-semibold">
          <Td>{data.profit >= 0 ? 'Profit' : 'Loss'}</Td>
          <Td className="text-right tabular-nums">{inr(Math.abs(data.profit))}</Td>
        </tr>
      </tbody>
    </Table>
  );
}

function BalanceSheetView({ data }: { data: BalanceSheet }) {
  return (
    <>
      {!data.balanced && (
        <Alert tone="error">The balance sheet doesn’t balance. Please report this to support.</Alert>
      )}
      <Table label="Balance sheet">
        <thead>
          <tr>
            <Th>Account</Th>
            <Th className="text-right">Amount</Th>
          </tr>
        </thead>
        <tbody>
          <SectionRows title="Assets" section={data.assets} />
          <SectionRows title="Liabilities" section={data.liabilities} />
          <SectionRows
            title="Equity"
            section={data.equity}
            extra={{ label: 'Current earnings (not yet closed)', amount: data.equity.currentEarnings }}
          />
          <tr className="font-semibold">
            <Td>Total liabilities and equity</Td>
            <Td className="text-right tabular-nums">{inr(data.liabilities.total + data.equity.total)}</Td>
          </tr>
        </tbody>
      </Table>
    </>
  );
}
