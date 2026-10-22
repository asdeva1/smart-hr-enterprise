'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ApiError, apiFetch } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert } from './ui/alert';
import { Button } from './ui/button';
import { Field } from './ui/field';
import { Input } from './ui/input';

/**
 * Asks for the password plus a second proof before a sensitive action the server refused with
 * REAUTH_REQUIRED: the authenticator code when two-step verification is on, otherwise (when the server asks
 * for it) a code it emails. The server decides when this is needed; this only collects the answer.
 */
export function ReauthPrompt({
  reason,
  mfaEnabled,
  onDone,
  onCancel,
}: {
  reason: string;
  mfaEnabled: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const session = useSession();
  const emailCode = !mfaEnabled && session.data?.user.reauthEmailCode === true;
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const form = useForm<{ password: string; code: string }>({ defaultValues: { password: '', code: '' } });

  async function sendCode() {
    setError(undefined);
    setSending(true);
    try {
      await apiFetch('/v1/auth/reauthenticate/code', { method: 'POST' });
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : 'We couldn’t send the code. Please try again.');
    } finally {
      setSending(false);
    }
  }

  const onSubmit = form.handleSubmit(async ({ password, code }) => {
    setError(undefined);
    try {
      await apiFetch('/v1/auth/reauthenticate', {
        method: 'POST',
        body: mfaEnabled ? { password, code } : emailCode ? { password, emailCode: code } : { password },
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : 'Something went wrong. Please try again.');
    }
  });
  return (
    <form
      className="flex max-w-md flex-col gap-4 rounded-md border border-warning/30 bg-warning-soft/40 p-4"
      onSubmit={onSubmit}
      noValidate
    >
      <p className="text-[13px]">{reason}</p>
      {error && <Alert tone="error">{error}</Alert>}
      <Field id="reauth-password" label="Your password">
        <Input
          id="reauth-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          {...form.register('password', { required: true })}
        />
      </Field>
      {mfaEnabled && (
        <Field id="reauth-code" label="Authenticator code">
          <Input
            id="reauth-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            {...form.register('code', { required: true })}
          />
        </Field>
      )}
      {emailCode && (
        <div className="flex flex-col gap-3">
          <Button type="button" variant="outline" onClick={() => void sendCode()} disabled={sending}>
            {sent ? 'Send a new code' : 'Email me a code'}
          </Button>
          {sent && (
            <>
              <Alert tone="success">We emailed a 6-digit code to your address. It works once.</Alert>
              <Field id="reauth-email-code" label="Code from your email">
                <Input
                  id="reauth-email-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  {...form.register('code', { required: true })}
                />
              </Field>
            </>
          )}
        </div>
      )}
      <div className="flex gap-3">
        <Button type="submit" disabled={form.formState.isSubmitting || (emailCode && !sent)}>
          Confirm
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
