'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { inr, useBooksCompany } from '@/lib/finance';
import { CompanyPicker, FinancePage, PurchasesTabs } from '../finance-page';

interface Bucket {
  current: number;
  d1to30: number;
  d31to60: number;
  d61to90: number;
  over90: number;
  total: number;
}
interface Ageing {
  rows: (Bucket & { vendor: { id: string; name: string } })[];
  totals: Bucket;
}
const COLS = [
  ['current', 'Not due'],
  ['d1to30', '1–30 days late'],
  ['d31to60', '31–60'],
  ['d61to90', '61–90'],
  ['over90', 'Over 90'],
  ['total', 'Total owed'],
] as const;

export default function PayablesPage() {
  return <FinancePage active="Bills and payments">{() => <Report />}</FinancePage>;
}

function Report() {
  const [companyId, setCompanyId] = useBooksCompany();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const q = useQuery({
    queryKey: ['purchases', 'ageing', companyId, asOf],
    queryFn: () => apiFetch<Ageing>(`/v1/finance/purchases/ageing?companyId=${companyId}&asOf=${asOf}`),
    enabled: !!companyId && !!asOf,
  });
  return (
    <>
      <PageHeader title="Payables ageing" description="What you owe each vendor, by how late it is." />
      <PurchasesTabs active="/finance/payables" />
      <div className="flex flex-wrap items-end gap-4">
        <CompanyPicker value={companyId} onChange={setCompanyId} />
        <Field id="pay-asof" label="As at">
          <Input id="pay-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </Field>
      </div>
      {!companyId || q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <Alert tone="error">{errorMessage(q.error)}</Alert>
      ) : q.data.rows.length === 0 ? (
        <EmptyState title="Nothing is owed">Every posted bill is paid.</EmptyState>
      ) : (
        <Table label="Payables ageing">
          <thead>
            <tr>
              <Th>Vendor</Th>
              {COLS.map(([k, label]) => (
                <Th key={k} className="text-right">
                  {label}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {q.data.rows.map((r) => (
              <tr key={r.vendor.id}>
                <Td className="font-medium">
                  <Link href={`/finance/vendors/${r.vendor.id}`} className="text-primary hover:underline">
                    {r.vendor.name}
                  </Link>
                </Td>
                {COLS.map(([k]) => (
                  <Td key={k} className="text-right tabular-nums">
                    {r[k] ? inr(r[k]) : ''}
                  </Td>
                ))}
              </tr>
            ))}
            <tr className="font-semibold">
              <Td>Total</Td>
              {COLS.map(([k]) => (
                <Td key={k} className="text-right tabular-nums">
                  {inr(q.data.totals[k])}
                </Td>
              ))}
            </tr>
          </tbody>
        </Table>
      )}
    </>
  );
}
