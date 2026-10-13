'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@smart-hr/validation';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { AuthLayout } from '@/components/auth-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    try {
      const res = await apiFetch<{ message: string }>('/v1/auth/password/forgot', {
        method: 'POST',
        body: values,
      });
      setSent(res.message);
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.detail : 'We couldn’t reach Smart HR. Please try again.',
      );
    }
  });

  return (
    <AuthLayout>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[26px] font-semibold tracking-tight">Reset your password</h1>
          <p className="text-muted-foreground">We’ll email you a link to choose a new password.</p>
        </div>
        {sent ? (
          <>
            <Alert tone="success">{sent} The link works once and expires after 30 minutes.</Alert>
            <Link href="/login" className="text-center text-[13px] text-primary hover:underline">
              Back to sign in
            </Link>
          </>
        ) : (
          <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
            {formError && <Alert tone="error">{formError}</Alert>}
            <Field id="email" label="Work email" error={errors.email?.message}>
              <Input
                type="email"
                autoComplete="email"
                autoFocus
                {...fieldAria('email', errors.email?.message)}
                {...form.register('email')}
              />
            </Field>
            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting ? 'Sending…' : 'Send reset link'}
            </Button>
            <Link href="/login" className="text-center text-[13px] text-primary hover:underline">
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </AuthLayout>
  );
}
