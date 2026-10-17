'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DocumentsTable } from '@/components/documents/documents-panel';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { documentKeys, type EmployeeDocument } from '@/lib/documents';
import { hasFeature } from '@/lib/permissions';
import { DocumentsPage, DocumentsTabs } from '../documents-page';

export default function ExpiringPage() {
  const [days, setDays] = useState(30);
  const list = useQuery({
    queryKey: documentKeys.expiring(days),
    queryFn: () => apiFetch<EmployeeDocument[]>(`/v1/documents/expiring?days=${days}`),
  });
  return (
    <DocumentsPage permission="documents.view">
      {(session) => (
        <>
          <PageHeader
            title="Documents"
            description="Documents that have expired or are about to, for the employees you look after."
          />
          <DocumentsTabs session={session} active="/documents/expiring" />
          <div className="max-w-xs">
            <Field id="expiring-days" label="Expiring within">
              <Select id="expiring-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={365}>A year</option>
              </Select>
            </Field>
          </div>
          {list.isPending ? (
            <Loading />
          ) : list.isError ? (
            <Alert tone="error">{errorMessage(list.error)}</Alert>
          ) : list.data.length === 0 ? (
            <EmptyState title="Nothing expiring">No documents expire in this period.</EmptyState>
          ) : (
            <DocumentsTable items={list.data} esign={hasFeature(session, 'esignature')} showEmployee />
          )}
        </>
      )}
    </DocumentsPage>
  );
}
