'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { confirmTotpSchema, newPasswordField, type ConfirmTotpInput } from '@smart-hr/validation';
import QRCode from 'qrcode';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useSignOut } from '@/hooks/use-sign-out';
import { ApiError, apiFetch, type SessionView } from '@/lib/api';
import { SESSION_KEY } from '@/lib/session';

function message(error: unknown): string {
  return error instanceof ApiError ? error.detail : 'We couldn’t reach Smart HR. Please try again.';
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      className="rounded-lg border border-border bg-card p-6"
      aria-labelledby={title.replace(/\W+/g, '-')}
    >
      <h2 id={title.replace(/\W+/g, '-')} className="text-[17px] font-semibold">
        {title}
      </h2>
      {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

// ------------------------------------------------------------------ change password

const changeSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: newPasswordField,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
type ChangeValues = z.infer<typeof changeSchema>;

function ChangePassword() {
  const client = useQueryClient();
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string }>();
  const form = useForm<ChangeValues>({
    resolver: zodResolver(changeSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    setResult(undefined);
    try {
      await apiFetch('/v1/auth/password/change', { method: 'POST', body: { currentPassword, newPassword } });
      form.reset();
      setResult({ tone: 'success', text: 'Password changed. You’ve been signed out on every other device.' });
      await client.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    } catch (error) {
      const fieldError =
        error instanceof ApiError ? error.fieldErrors.find((e) => e.path === 'newPassword') : undefined;
      if (fieldError) form.setError('newPassword', { message: fieldError.message });
      else setResult({ tone: 'error', text: message(error) });
    }
  });

  return (
    <form className="flex max-w-md flex-col gap-4" onSubmit={onSubmit} noValidate>
      {result && <Alert tone={result.tone}>{result.text}</Alert>}
      <Field id="currentPassword" label="Current password" error={errors.currentPassword?.message}>
        <Input
          type="password"
          autoComplete="current-password"
          {...fieldAria('currentPassword', errors.currentPassword?.message)}
          {...form.register('currentPassword')}
        />
      </Field>
      <Field
        id="newPassword"
        label="New password"
        error={errors.newPassword?.message}
        hint="At least 12 characters."
      >
        <Input
          type="password"
          autoComplete="new-password"
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
      <div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Change password'}
        </Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ re-authentication

function ReauthForm({
  mfaEnabled,
  onDone,
  onCancel,
}: {
  mfaEnabled: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string>();
  const form = useForm<{ password: string; code: string }>({ defaultValues: { password: '', code: '' } });

  const onSubmit = form.handleSubmit(async ({ password, code }) => {
    setError(undefined);
    try {
      await apiFetch('/v1/auth/reauthenticate', {
        method: 'POST',
        body: mfaEnabled ? { password, code } : { password },
      });
      onDone();
    } catch (e) {
      setError(message(e));
    }
  });

  return (
    <form
      className="flex max-w-md flex-col gap-4 rounded-md border border-warning/30 bg-warning-soft/40 p-4"
      onSubmit={onSubmit}
      noValidate
    >
      <p className="text-[13px]">
        For your security, confirm it’s you before changing two-step verification.
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      <Field id="reauthPassword" label="Password">
        <Input
          id="reauthPassword"
          type="password"
          autoComplete="current-password"
          autoFocus
          {...form.register('password', { required: true })}
        />
      </Field>
      {mfaEnabled && (
        <Field id="reauthCode" label="Authenticator code">
          <Input
            id="reauthCode"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            {...form.register('code', { required: true })}
          />
        </Field>
      )}
      <div className="flex gap-3">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          Confirm
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ two-step verification

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const download = () => {
    const blob = new Blob([`Smart HR recovery codes\nEach code works once.\n\n${codes.join('\n')}\n`], {
      type: 'text/plain',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'smart-hr-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="warning">
        Save these recovery codes somewhere safe. Each works once if you lose your phone. They won’t be shown
        again.
      </Alert>
      <ul
        aria-label="Recovery codes"
        className="grid max-w-md grid-cols-2 gap-2 rounded-md border border-border bg-muted p-4 font-mono text-sm"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={download}>
          Download as text file
        </Button>
        <Button onClick={onDone}>I’ve saved them</Button>
      </div>
    </div>
  );
}

function Enrolment({ onEnabled }: { onEnabled: (codes: string[]) => void }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: string }>();
  const [error, setError] = useState<string>();
  const form = useForm<ConfirmTotpInput>({
    resolver: zodResolver(confirmTotpSchema),
    defaultValues: { code: '' },
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiFetch<{ secret: string; uri: string }>('/v1/auth/mfa/totp/setup', {
          method: 'POST',
        });
        const qr = await QRCode.toDataURL(data.uri, { margin: 1, width: 200 });
        if (!cancelled) setSetup({ ...data, qr });
      } catch (e) {
        if (!cancelled) setError(message(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(undefined);
    try {
      const res = await apiFetch<{ recoveryCodes: string[] }>('/v1/auth/mfa/totp/confirm', {
        method: 'POST',
        body: values,
      });
      onEnabled(res.recoveryCodes);
    } catch (e) {
      setError(message(e));
    }
  });

  if (error && !setup) return <Alert tone="error">{error}</Alert>;
  if (!setup)
    return (
      <p role="status" className="text-muted-foreground">
        Preparing…
      </p>
    );

  return (
    <div className="flex flex-wrap gap-8">
      <div className="flex flex-col items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- locally generated data: URL; nothing to optimise or fetch */}
        <img
          src={setup.qr}
          width={200}
          height={200}
          alt="QR code to add Smart HR to your authenticator app"
          className="rounded-md border border-border"
        />
        <details className="text-[13px]">
          <summary className="cursor-pointer text-primary">Can’t scan? Enter the key instead</summary>
          <code className="mt-2 block break-all rounded bg-muted p-2 font-mono text-xs">{setup.secret}</code>
        </details>
      </div>
      <form className="flex min-w-[260px] flex-1 flex-col gap-4" onSubmit={onSubmit} noValidate>
        <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted-foreground">
          <li>
            Open an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password.
          </li>
          <li>Scan the QR code.</li>
          <li>Enter the 6-digit code it shows.</li>
        </ol>
        {error && <Alert tone="error">{error}</Alert>}
        <Field id="enrolCode" label="Code from your app" error={form.formState.errors.code?.message}>
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="font-mono tracking-[0.3em]"
            {...fieldAria('enrolCode', form.formState.errors.code?.message)}
            {...form.register('code')}
          />
        </Field>
        <div>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Turn on
          </Button>
        </div>
      </form>
    </div>
  );
}

type MfaMode = 'idle' | 'enrolling' | 'codes';

function TwoStep({ session }: { session: SessionView }) {
  const client = useQueryClient();
  const [mode, setMode] = useState<MfaMode>('idle');
  const [codes, setCodes] = useState<string[]>([]);
  const [pending, setPending] = useState<(() => Promise<void>) | null>(null);
  const [error, setError] = useState<string>();
  const enabled = session.user.mfaEnabled;

  /** Runs an action; if the server wants fresh confirmation, asks for it and then retries. */
  async function guarded(action: () => Promise<void>) {
    setError(undefined);
    try {
      await action();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'REAUTH_REQUIRED') setPending(() => action);
      else setError(message(e));
    }
  }

  const refreshSession = () => client.invalidateQueries({ queryKey: SESSION_KEY });

  if (pending) {
    return (
      <ReauthForm
        mfaEnabled={enabled}
        onCancel={() => setPending(null)}
        onDone={() => {
          const action = pending;
          setPending(null);
          void guarded(action);
        }}
      />
    );
  }

  if (mode === 'codes') {
    return (
      <RecoveryCodes
        codes={codes}
        onDone={() => {
          setCodes([]);
          setMode('idle');
          void refreshSession();
        }}
      />
    );
  }

  if (mode === 'enrolling') {
    return (
      <Enrolment
        onEnabled={(recoveryCodes) => {
          setCodes(recoveryCodes);
          setMode('codes');
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}
      <p className="flex items-center gap-2">
        Status:
        <span
          className={
            enabled
              ? 'rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-semibold text-success'
              : 'rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold'
          }
        >
          {enabled ? 'On' : 'Off'}
        </span>
      </p>
      <div className="flex flex-wrap gap-3">
        {enabled ? (
          <>
            <Button
              variant="outline"
              onClick={() =>
                void guarded(async () => {
                  const res = await apiFetch<{ recoveryCodes: string[] }>('/v1/auth/mfa/recovery-codes', {
                    method: 'POST',
                  });
                  setCodes(res.recoveryCodes);
                  setMode('codes');
                })
              }
            >
              Get new recovery codes
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                void guarded(async () => {
                  await apiFetch('/v1/auth/mfa/totp', { method: 'DELETE' });
                  await refreshSession();
                })
              }
            >
              Turn off
            </Button>
          </>
        ) : (
          <Button
            onClick={() =>
              void guarded(async () => {
                // Probe the recent-auth requirement before showing the enrolment screen.
                await apiFetch('/v1/auth/mfa/totp/setup', { method: 'POST' });
                setMode('enrolling');
              })
            }
          >
            Set up authenticator app
          </Button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ sessions and activity

interface SessionRow {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function Sessions() {
  const client = useQueryClient();
  const signOut = useSignOut();
  const sessions = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: () => apiFetch<SessionRow[]>('/v1/auth/sessions'),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/v1/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['auth', 'sessions'] }),
  });

  if (sessions.isPending)
    return (
      <p role="status" className="text-muted-foreground">
        Loading…
      </p>
    );
  if (sessions.isError) return <Alert tone="error">{message(sessions.error)}</Alert>;

  return (
    <div className="flex flex-col gap-4">
      {revoke.isError && <Alert tone="error">{message(revoke.error)}</Alert>}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-semibold">
                Device
              </th>
              <th scope="col" className="px-4 py-2.5 font-semibold">
                IP address
              </th>
              <th scope="col" className="px-4 py-2.5 font-semibold">
                Last active
              </th>
              <th scope="col" className="px-4 py-2.5">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.data.map((s) => (
              <tr key={s.id} className="border-t border-border">
                <td className="px-4 py-3">
                  {describeAgent(s.userAgent)}
                  {s.current && (
                    <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
                      This device
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-[13px]">{s.ipAddress ?? '—'}</td>
                <td className="px-4 py-3">{dateTime.format(new Date(s.lastSeenAt))}</td>
                <td className="px-4 py-3 text-right">
                  {!s.current && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(s.id)}
                    >
                      Sign out
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <Button variant="danger" onClick={() => void signOut(true)}>
          Sign out everywhere
        </Button>
      </div>
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Sign-in',
  'auth.login.password_verified': 'Password accepted, waiting for code',
  'auth.logout': 'Signed out',
  'auth.sessions.revoke_all': 'Signed out everywhere',
  'auth.session.revoke': 'Signed out a device',
  'auth.password.change': 'Password changed',
  'auth.password.reset': 'Password reset',
  'auth.password.reset_requested': 'Password reset requested',
  'auth.mfa.enable': 'Two-step verification turned on',
  'auth.mfa.disable': 'Two-step verification turned off',
  'auth.mfa.enrolment_started': 'Two-step verification setup started',
  'auth.mfa.recovery_codes_regenerated': 'New recovery codes',
  'auth.account.locked': 'Account locked after failed attempts',
  'auth.reauthenticate': 'Identity confirmed',
  'auth.tenant.switch': 'Switched organisation',
};

function Activity() {
  const events = useQuery({
    queryKey: ['auth', 'events'],
    queryFn: () =>
      apiFetch<{ action: string; outcome: string; occurredAt: string; ipAddress: string | null }[]>(
        '/v1/auth/security-events',
      ),
  });
  if (events.isPending)
    return (
      <p role="status" className="text-muted-foreground">
        Loading…
      </p>
    );
  if (events.isError) return <Alert tone="error">{message(events.error)}</Alert>;
  if (events.data.length === 0) return <p className="text-muted-foreground">No activity yet.</p>;
  return (
    <ul className="divide-y divide-border">
      {events.data.map((e, i) => (
        <li key={`${e.occurredAt}-${i}`} className="flex flex-wrap justify-between gap-2 py-2.5 text-sm">
          <span>
            {ACTION_LABELS[e.action] ?? e.action}
            {e.outcome !== 'SUCCESS' && (
              <span className="ml-2 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">
                {e.outcome === 'DENIED' ? 'Blocked' : 'Failed'}
              </span>
            )}
          </span>
          <span className="text-muted-foreground">
            {dateTime.format(new Date(e.occurredAt))}
            {e.ipAddress && <span className="ml-2 font-mono text-xs">{e.ipAddress}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SecuritySettings({ session }: { session: SessionView }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[26px] font-semibold tracking-tight">Account and security</h1>
        <p className="text-muted-foreground">
          Signed in as {session.user.displayName} ({session.user.email})
        </p>
      </div>
      <Section title="Password" description="Changing your password signs you out on every other device.">
        <ChangePassword />
      </Section>
      <Section
        title="Two-step verification"
        description="Ask for a code from your phone each time you sign in."
      >
        <TwoStep session={session} />
      </Section>
      <Section title="Where you’re signed in" description="Sign out of devices you don’t recognise.">
        <Sessions />
      </Section>
      <Section title="Recent security activity">
        <Activity />
      </Section>
    </div>
  );
}
