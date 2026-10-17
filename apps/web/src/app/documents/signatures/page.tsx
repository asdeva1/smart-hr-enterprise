'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Tabs } from '@/components/ui/tabs';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import {
  formatWhen,
  SIGNATURE_STATUS_LABEL,
  SIGNATURE_STATUS_TONE,
  SIGNER_STATUS_LABEL,
  useSignatures,
} from '@/lib/documents';
import { can, hasFeature } from '@/lib/permissions';
import { DocumentsPage, DocumentsTabs } from '../documents-page';

type Scope = 'mine' | 'sent' | 'all';

export default function SignaturesPage() {
  return (
    <DocumentsPage>
      {(session) => {
        if (!hasFeature(session, 'esignature')) {
          return <Alert tone="info">Your organisation’s plan doesn’t include electronic signatures.</Alert>;
        }
        return (
          <>
            <PageHeader
              title="Documents"
              description="Documents waiting for your signature, and those you sent."
            />
            <DocumentsTabs session={session} active="/documents/signatures" />
            <SignatureLists
              staff={can(session, 'documents.manage')}
              viewer={can(session, 'documents.view')}
            />
          </>
        );
      }}
    </DocumentsPage>
  );
}

function SignatureLists({ staff, viewer }: { staff: boolean; viewer: boolean }) {
  const [scope, setScope] = useState<Scope>('mine');
  const list = useSignatures(scope);
  return (
    <>
      <Tabs
        label="Signature requests"
        value={scope}
        onChange={setScope}
        options={[
          { value: 'mine', label: 'For me to sign' },
          ...(staff ? [{ value: 'sent' as const, label: 'Sent by me' }] : []),
          ...(viewer ? [{ value: 'all' as const, label: 'All' }] : []),
        ]}
      />
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <Alert tone="error">{errorMessage(list.error)}</Alert>
      ) : list.data.length === 0 ? (
        <EmptyState title={scope === 'mine' ? 'Nothing to sign' : 'No signature requests'} />
      ) : (
        <Table label="Signature requests">
          <thead>
            <tr>
              <Th>Document</Th>
              <Th>Employee</Th>
              <Th>Sent</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((r) => (
              <tr key={r.id}>
                <Td>
                  <Link
                    href={`/documents/signatures/${r.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {r.title}
                  </Link>
                </Td>
                <Td>{r.employee.name}</Td>
                <Td>{formatWhen(r.createdAt)}</Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    <Badge tone={SIGNATURE_STATUS_TONE[r.status]}>{SIGNATURE_STATUS_LABEL[r.status]}</Badge>
                    {r.status === 'PENDING' && r.me && (
                      <Badge tone="warning">{SIGNER_STATUS_LABEL[r.me.status]}</Badge>
                    )}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
