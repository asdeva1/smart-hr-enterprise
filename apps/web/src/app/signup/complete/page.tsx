import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthLayout } from '@/components/auth-layout';
import { CompleteSignupForm } from './complete-form';

export const metadata: Metadata = { title: 'Finish creating your organisation', referrer: 'no-referrer' };

export default function CompleteSignupPage() {
  return (
    <AuthLayout>
      <Suspense>
        <CompleteSignupForm />
      </Suspense>
    </AuthLayout>
  );
}
