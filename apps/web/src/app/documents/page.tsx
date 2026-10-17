'use client';

import { DocumentsPanel } from '@/components/documents/documents-panel';
import { PageHeader } from '@/components/ui/page-header';
import { DocumentsPage, DocumentsTabs } from './documents-page';

export default function MyDocumentsPage() {
  return (
    <DocumentsPage>
      {(session) => (
        <>
          <PageHeader
            title="Documents"
            description="Documents on your employee record, and anything waiting for your signature."
          />
          <DocumentsTabs session={session} active="/documents" />
          <DocumentsPanel session={session} />
        </>
      )}
    </DocumentsPage>
  );
}
