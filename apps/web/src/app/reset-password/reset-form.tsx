'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { newPasswordWithConfirmSchema } from '@smart-hr/validation';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/api';

type Values = z.infer<typeof newPasswordWithConfirmSchema>;

export function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const [formError, setFormError] = useState<string>();
  const form = useForm<Values>({
    resolver: zodResolver(newPasswordWithConfirmSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ newPassword }) => {
    setFormError(undefined);
    try {
      await apiFetch('/v1/auth/password/reset', { method: 'POST', body: { token, newPassword } });
      router.replace('/login?reason=password-reset');
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldError = error.fieldErrors.find((e) => e.path === 'newPassword');
        if (fieldError) form.setError('newPassword', { message: fieldError.message });
        else setFormError(error.detail);
      } else {
        setFormError('We couldn’t reach Smart HR. Please try again.');
      }
    }
  });

  if (!token) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-[26px] font-semibold tracking-tight">Link not valid</h1>
        <Alert tone="error">This reset link is incomplete. Request a new one.</Alert>
        <Link href="/forgot-password" className="text-[13px] text-primary hover:underline">
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-semibold tracking-tight">Choose a new password</h1>
        <p className="text-muted-foreground">You’ll be signed out everywhere and asked to sign in again.</p>
      </div>
      {formError && (
        <Alert tone="error">
          {formError}{' '}
          <Link href="/forgot-password" className="underline">
            Request a new link
          </Link>
        </Alert>
      )}
      <Field
        id="newPassword"
        label="New password"
        error={errors.newPassword?.message}
        hint="At least 12 characters. A short phrase is easier to remember."
      >
        <Input
          type="password"
          autoComplete="new-password"
          autoFocus
          {...fieldAria('newPassword', errors.newPassword?.message, 'hint')}
          {...form.register('newPassword')}
        />
      </Field>
      <Field id="confirmPassword" label="Confirm new password" error={errors.confirmPassword?.message}>
        <Input
          type="password"
          autoComplete="new-password"
          {...fieldAria('confirmPassword', errors.confirmPassword?.message)}
          {...form.register('confirmPassword')}
        />
      </Field>
      <Button type="submit" size="lg" disabled={isSubmitting}>
        {isSubmitting ? 'Saving…' : 'Set new password'}
      </Button>
    </form>
  );
}
