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

export function CompleteSignupForm() {
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
      await apiFetch('/v1/signup/complete', { method: 'POST', body: { token, password: newPassword } });
      router.replace('/login?reason=organisation-ready');
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldError = error.fieldErrors.find((e) => e.path === 'password');
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
        <Alert tone="error">This sign-up link is incomplete. Please sign up again.</Alert>
        <Link href="/signup" className="text-[13px] text-primary hover:underline">
          Sign up again
        </Link>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-semibold tracking-tight">Choose your password</h1>
        <p className="text-muted-foreground">This creates your account and your organisation.</p>
      </div>
      {formError && (
        <Alert tone="error">
          {formError}{' '}
          <Link href="/signup" className="underline">
            Sign up again
          </Link>
        </Alert>
      )}
      <Field
        id="newPassword"
        label="Password"
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
      <Field id="confirmPassword" label="Confirm password" error={errors.confirmPassword?.message}>
        <Input
          type="password"
          autoComplete="new-password"
          {...fieldAria('confirmPassword', errors.confirmPassword?.message)}
          {...form.register('confirmPassword')}
        />
      </Field>
      <Button type="submit" size="lg" disabled={isSubmitting}>
        {isSubmitting ? 'Creating…' : 'Create organisation'}
      </Button>
    </form>
  );
}
