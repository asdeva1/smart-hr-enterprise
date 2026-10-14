'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { signupSchema, type SignupInput } from '@smart-hr/validation';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { AuthLayout } from '@/components/auth-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * Self-service sign-up. Nothing is created until the emailed link is opened, and the answer is the same
 * whether or not the address already has an account. The API returns 404 when sign-up is turned off.
 */
export default function SignupPage() {
  const [sentTo, setSentTo] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const form = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { organisationName: '', displayName: '', email: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    try {
      await apiFetch('/v1/signup', { method: 'POST', body: values });
      setSentTo(values.email);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setFormError('Sign-up isn’t available here. Ask your administrator to invite you.');
      } else {
        setFormError(
          error instanceof ApiError ? error.detail : 'We couldn’t reach Smart HR. Please try again.',
        );
      }
    }
  });

  return (
    <AuthLayout>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[26px] font-semibold tracking-tight">Create your organisation</h1>
          <p className="text-muted-foreground">Start with a free trial. No card needed.</p>
        </div>
        {sentTo ? (
          <>
            <Alert tone="success">
              Check {sentTo} for a link to choose your password. Your organisation is created when you open
              it.
            </Alert>
            <Link href="/login" className="text-center text-[13px] text-primary hover:underline">
              Back to sign in
            </Link>
          </>
        ) : (
          <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
            {formError && <Alert tone="error">{formError}</Alert>}
            <Field id="organisationName" label="Organisation name" error={errors.organisationName?.message}>
              <Input
                autoComplete="organization"
                autoFocus
                {...fieldAria('organisationName', errors.organisationName?.message)}
                {...form.register('organisationName')}
              />
            </Field>
            <Field id="displayName" label="Your name" error={errors.displayName?.message}>
              <Input
                autoComplete="name"
                {...fieldAria('displayName', errors.displayName?.message)}
                {...form.register('displayName')}
              />
            </Field>
            <Field id="email" label="Work email" error={errors.email?.message}>
              <Input
                type="email"
                autoComplete="email"
                {...fieldAria('email', errors.email?.message)}
                {...form.register('email')}
              />
            </Field>
            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting ? 'Sending…' : 'Email me a link'}
            </Button>
            <Link href="/login" className="text-center text-[13px] text-primary hover:underline">
              Already have an account? Sign in
            </Link>
          </form>
        )}
      </div>
    </AuthLayout>
  );
}
