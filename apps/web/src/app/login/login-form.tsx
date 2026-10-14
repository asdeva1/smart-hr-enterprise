'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, recoveryCodeField, totpCodeField, type LoginInput } from '@smart-hr/validation';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useSignOut } from '@/hooks/use-sign-out';
import { ApiError, apiFetch, safeNextPath, type SessionView } from '@/lib/api';
import { useSession, useSetSession } from '@/lib/session';

const REASONS: Record<string, { tone: 'info' | 'warning' | 'success'; text: string }> = {
  expired: { tone: 'warning', text: 'Your session ended. Please sign in again.' },
  'signed-out': { tone: 'info', text: 'You’re signed out.' },
  'password-reset': {
    tone: 'success',
    text: 'Your password has been changed. Sign in with your new password.',
  },
  'organisation-ready': {
    tone: 'success',
    text: 'Your organisation is ready. Sign in with the password you just chose.',
  },
  'account-ready': {
    tone: 'success',
    text: 'Your account is ready. Sign in with your email and new password.',
  },
};

function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  return 'We couldn’t reach Smart HR. Check your connection and try again.';
}

export function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();
  const setSession = useSetSession();
  const { data: existing } = useSession();
  const [chosenStep, setStep] = useState<'password' | 'mfa' | null>(null);
  // A refresh in the middle of two-step sign-in returns to the code step.
  const step = chosenStep ?? (existing?.mfaPending ? 'mfa' : 'password');
  const reason = REASONS[params.get('reason') ?? ''];
  const next = safeNextPath(params.get('next'));

  function proceed(view: SessionView) {
    setSession(view);
    if (view.mfaPending) {
      setStep('mfa');
    } else if (!view.activeTenant && view.memberships.length > 1) {
      router.replace(`/select-organisation?next=${encodeURIComponent(next)}`);
    } else {
      router.replace(next);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {step === 'password' ? (
        <PasswordStep onSuccess={proceed} notice={reason} />
      ) : (
        <SecondFactorStep onSuccess={proceed} />
      )}
    </div>
  );
}

function PasswordStep({
  onSuccess,
  notice,
}: {
  onSuccess: (view: SessionView) => void;
  notice: { tone: 'info' | 'warning' | 'success'; text: string } | undefined;
}) {
  const [formError, setFormError] = useState<string>();
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    try {
      onSuccess(await apiFetch<SessionView>('/v1/auth/login', { method: 'POST', body: values }));
    } catch (error) {
      setFormError(errorText(error));
      form.resetField('password');
    }
  });

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-semibold tracking-tight">Sign in</h1>
        <p className="text-muted-foreground">Use your work account for this organisation.</p>
      </div>
      {notice && !formError && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {formError && <Alert tone="error">{formError}</Alert>}
      <Field id="email" label="Work email" error={errors.email?.message}>
        <Input
          type="email"
          autoComplete="username"
          autoFocus
          {...fieldAria('email', errors.email?.message)}
          {...form.register('email')}
        />
      </Field>
      <Field
        id="password"
        label="Password"
        error={errors.password?.message}
        action={
          <Link href="/forgot-password" className="text-[13px] text-primary hover:underline">
            Forgot password?
          </Link>
        }
      >
        <Input
          type="password"
          autoComplete="current-password"
          {...fieldAria('password', errors.password?.message)}
          {...form.register('password')}
        />
      </Field>
      <Button type="submit" size="lg" disabled={isSubmitting}>
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="text-xs text-muted-foreground">
        After several failed attempts the account is locked for a short time. Your administrator can turn on
        single sign-on for your organisation.
      </p>
      {process.env.NEXT_PUBLIC_SIGNUP_ENABLED === 'true' && (
        <p className="text-center text-[13px] text-muted-foreground">
          New to Smart HR?{' '}
          <Link href="/signup" className="text-primary hover:underline">
            Create an organisation
          </Link>
        </p>
      )}
    </form>
  );
}

const codeSchema = z.object({ code: totpCodeField });
const recoverySchema = z.object({ recoveryCode: recoveryCodeField });

function SecondFactorStep({ onSuccess }: { onSuccess: (view: SessionView) => void }) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [formError, setFormError] = useState<string>();
  const signOut = useSignOut();
  const codeForm = useForm<{ code: string }>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: '' },
  });
  const recoveryForm = useForm<{ recoveryCode: string }>({
    resolver: zodResolver(recoverySchema),
    defaultValues: { recoveryCode: '' },
  });

  async function verify(body: { code: string } | { recoveryCode: string }) {
    setFormError(undefined);
    try {
      onSuccess(await apiFetch<SessionView>('/v1/auth/mfa/verify', { method: 'POST', body }));
    } catch (error) {
      if (error instanceof ApiError && error.needsSignIn && error.code !== 'MFA_REQUIRED') {
        await signOut();
        return;
      }
      setFormError(errorText(error));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-semibold tracking-tight">Two-step verification</h1>
        <p className="text-muted-foreground">
          {useRecovery
            ? 'Enter one of the recovery codes you saved when you set up two-step verification.'
            : 'Enter the 6-digit code from your authenticator app.'}
        </p>
      </div>
      {formError && <Alert tone="error">{formError}</Alert>}

      {useRecovery ? (
        <form className="flex flex-col gap-5" onSubmit={recoveryForm.handleSubmit(verify)} noValidate>
          <Field
            id="recoveryCode"
            label="Recovery code"
            error={recoveryForm.formState.errors.recoveryCode?.message}
          >
            <Input
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              autoFocus
              {...fieldAria('recoveryCode', recoveryForm.formState.errors.recoveryCode?.message)}
              {...recoveryForm.register('recoveryCode')}
            />
          </Field>
          <Button type="submit" size="lg" disabled={recoveryForm.formState.isSubmitting}>
            Verify
          </Button>
        </form>
      ) : (
        <form className="flex flex-col gap-5" onSubmit={codeForm.handleSubmit(verify)} noValidate>
          <Field id="code" label="Verification code" error={codeForm.formState.errors.code?.message}>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              className="font-mono text-lg tracking-[0.3em]"
              {...fieldAria('code', codeForm.formState.errors.code?.message)}
              {...codeForm.register('code')}
            />
          </Field>
          <Button type="submit" size="lg" disabled={codeForm.formState.isSubmitting}>
            Verify
          </Button>
        </form>
      )}

      <div className="flex flex-wrap justify-between gap-3 text-[13px]">
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => setUseRecovery((v) => !v)}
        >
          {useRecovery ? 'Use authenticator app instead' : 'Use a recovery code'}
        </button>
        <button
          type="button"
          className="text-muted-foreground hover:underline"
          onClick={() => void signOut()}
        >
          Use a different account
        </button>
      </div>
    </div>
  );
}
