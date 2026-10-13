import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthLayout } from '@/components/auth-layout';
import { SelectOrganisation } from './select-form';

export const metadata: Metadata = { title: 'Choose an organisation' };

export default function SelectOrganisationPage() {
  return (
    <AuthLayout>
      <Suspense>
        <SelectOrganisation />
      </Suspense>
    </AuthLayout>
  );
}
