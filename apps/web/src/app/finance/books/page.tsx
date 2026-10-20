'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { financeKeys, useBooksCompany } from '@/lib/finance';
import { CompanyPicker, FinancePage, FinanceTabs } from '../finance-page';

export default function BooksPage() {
  return <FinancePage permission="finance.configure">{(session) => <Books session={session} />}</FinancePage>;
}

function Books({ session }: { session: Parameters<typeof FinanceTabs>[0]['session'] }) {
  const client = useQueryClient();
  const [companyId, setCompanyId] = useBooksCompany();
  const lock = useQuery({
    queryKey: financeKeys.books(companyId),
    queryFn: () => apiFetch<{ lockedUntil: string | null }>(`/v1/finance/books/${companyId}`),
    enabled: !!companyId,
  });
  const [edited, setDate] = useState<string | null>(null);
  const date = edited ?? lock.data?.lockedUntil ?? '';
  const save = useMutation({
    mutationFn: (lockedUntil: string | null) =>
      apiFetch(`/v1/finance/books/${companyId}`, { method: 'PUT', body: { lockedUntil } }),
    onSuccess: () => client.invalidateQueries({ queryKey: financeKeys.all }),
  });
  return (
    <>
      <PageHeader
        title="Close the books"
        description="Once closed, nothing can be posted on or before the date — corrections go in open books as reversals. Closing and reopening are recorded in the audit log."
      />
      <FinanceTabs session={session} active="/finance/books" />
      <CompanyPicker value={companyId} onChange={setCompanyId} />
      {!companyId || lock.isPending ? (
        <Loading />
      ) : lock.isError ? (
        <Alert tone="error">{errorMessage(lock.error)}</Alert>
      ) : (
        <div className="flex max-w-md flex-col gap-4 rounded-lg border border-border bg-card p-4">
          <p>
            {lock.data.lockedUntil
              ? `The books are closed up to and including ${lock.data.lockedUntil}.`
              : 'The books are open.'}
          </p>
          {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
          {save.isSuccess && <Alert tone="success">Saved.</Alert>}
          <Field
            id="lock-date"
            label="Closed up to"
            hint="Every journal on or before this date must be posted or cancelled first."
          >
            <Input id="lock-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!date || save.isPending} onClick={() => save.mutate(date)}>
              Close the books
            </Button>
            {lock.data.lockedUntil && (
              <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate(null)}>
                Reopen fully
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
