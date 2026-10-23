'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/page-header';
import { useBooksCompany } from '@/lib/finance';
import { FinancePage } from '../../finance-page';
import { BillEditor } from '../bill-editor';

export default function NewBillPage() {
  return (
    <FinancePage permission="finance.manage" active="Bills and payments">
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
  if (!companyId) return <Loading />;
  return (
    <BillEditor companyId={companyId} type={params.get('type') === 'DEBIT_NOTE' ? 'DEBIT_NOTE' : 'BILL'} />
  );
}
