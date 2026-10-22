'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/page-header';
import { useBooksCompany } from '@/lib/finance';
import type { SalesDocType } from '@/lib/sales';
import { FinancePage } from '../../finance-page';
import { DocumentEditor } from '../document-editor';

const TYPES: SalesDocType[] = ['INVOICE', 'QUOTATION', 'PROFORMA', 'CHALLAN', 'CREDIT_NOTE'];

export default function NewDocumentPage() {
  return (
    <FinancePage permission="finance.manage" active="Invoices">
      {() => (
        <Suspense fallback={<Loading />}>
          <New />
        </Suspense>
      )}
    </FinancePage>
  );
}

function New() {
  const params = useSearchParams();
  const [companyId] = useBooksCompany();
  const t = params.get('type') as SalesDocType;
  const type = TYPES.includes(t) ? t : 'INVOICE';
  if (!companyId) return <Loading />;
  return <DocumentEditor companyId={companyId} type={type} />;
}
