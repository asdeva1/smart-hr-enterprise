import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthLayout } from '@/components/auth-layout';
import { ResetForm } from './reset-form';

export const metadata: Metadata = { title: 'Choose a new password', referrer: 'no-referrer' };

export default function ResetPasswordPage() {
  return (
    <AuthLayout>
      <Suspense>
        <ResetForm />
      </Suspense>
    </AuthLayout>
  );
}
