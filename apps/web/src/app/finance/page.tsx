'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { JournalDialog } from '@/components/finance/journal-form';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import {
  financeKeys,
  inr,
  JOURNAL_STATUS_LABEL,
  JOURNAL_STATUS_TONE,
  SOURCE_LABEL,
  useBooksCompany,
  type Journal,
} from '@/lib/finance';
import { can } from '@/lib/permissions';
import { CompanyPicker, FinancePage, FinanceTabs } from './finance-page';

export default function JournalsPage() {
  return <FinancePage>{(session) => <Journals session={session} />}</FinancePage>;
}

function Journals({ session }: { session: Parameters<typeof FinanceTabs>[0]['session'] }) {
  const router = useRouter();
  const [companyId, setCompanyId] = useBooksCompany();
  const [status, setStatus] = useState('ALL');
  const [creating, setCreating] = useState(false);
  const journals = useQuery({
    queryKey: financeKeys.journals(companyId, status),
    queryFn: () => apiFetch<Journal[]>(`/v1/finance/journals?companyId=${companyId}&status=${status}`),
    enabled: !!companyId,
  });
  return (
    <>
      <PageHeader
        title="Finance"
        description="Double-entry books for each company. Journals post once approved, and payroll posts itself."
        actions={
          can(session, 'finance.manage') && companyId ? (
            <Button onClick={() => setCreating(true)}>New journal</Button>
          ) : null
        }
      />
      <FinanceTabs session={session} active="/finance" />
      <div className="flex flex-wrap gap-4">
        <CompanyPicker value={companyId} onChange={setCompanyId} />
        <div className="max-w-xs">
          <Field id="journal-status" label="Status">
            <Select id="journal-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ALL">All</option>
              {Object.entries(JOURNAL_STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
      {!companyId || journals.isPending ? (
        <Loading />
      ) : journals.isError ? (
        <Alert tone="error">{errorMessage(journals.error)}</Alert>
      ) : journals.data.length === 0 ? (
        <EmptyState title="No journals yet">
          Approved payroll posts here automatically, or draft a journal yourself.
        </EmptyState>
      ) : (
        <Table label="Journals">
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Number</Th>
              <Th>Narration</Th>
              <Th>Source</Th>
              <Th className="text-right">Amount</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {journals.data.map((j) => (
              <tr key={j.id}>
                <Td className="whitespace-nowrap">{j.date}</Td>
                <Td className="whitespace-nowrap">
                  <Link
                    href={`/finance/journals/${j.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {j.number ?? 'Draft'}
                  </Link>
                </Td>
                <Td>{j.narration}</Td>
                <Td>{SOURCE_LABEL[j.source]}</Td>
                <Td className="text-right tabular-nums">{inr(j.total)}</Td>
                <Td>
                  <Badge tone={JOURNAL_STATUS_TONE[j.status]}>{JOURNAL_STATUS_LABEL[j.status]}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {creating && (
        <JournalDialog
          companyId={companyId}
          onClose={() => setCreating(false)}
          onSaved={(j) => router.push(`/finance/journals/${j.id}`)}
        />
      )}
    </>
  );
}
