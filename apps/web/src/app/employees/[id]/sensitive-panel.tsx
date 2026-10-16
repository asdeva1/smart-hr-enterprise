'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { employeeSensitiveSchema, type EmployeeSensitiveInput } from '@smart-hr/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ReauthPrompt } from '@/components/reauth-prompt';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading } from '@/components/ui/page-header';
import { applyFieldErrors, errorMessage } from '@/lib/admin';
import { ApiError, apiFetch, type SessionView } from '@/lib/api';
import { employeeKeys, type Employee, type SensitiveDetails } from '@/lib/employees';

type Pending = { kind: 'reveal' } | { kind: 'save'; body: z.output<typeof employeeSensitiveSchema> };

/**
 * PAN, Aadhaar and bank details. Shown masked; showing full numbers or changing them asks for the
 * password when it wasn't entered recently, and the server records every reveal in the audit log.
 */
export function SensitivePanel({ employee: e, session }: { employee: Employee; session: SessionView }) {
  const client = useQueryClient();
  const masked = useQuery({
    queryKey: employeeKeys.sensitive(e.id),
    queryFn: () => apiFetch<SensitiveDetails>(`/v1/employees/${e.id}/sensitive`),
  });
  const [revealed, setRevealed] = useState<SensitiveDetails | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();

  const reveal = useMutation({
    mutationFn: () =>
      apiFetch<SensitiveDetails>(`/v1/employees/${e.id}/sensitive/reveal`, { method: 'POST' }),
    onSuccess: setRevealed,
    onError: (err) => handle(err, { kind: 'reveal' }),
  });
  const save = useMutation({
    mutationFn: (body: z.output<typeof employeeSensitiveSchema>) =>
      apiFetch<SensitiveDetails>(`/v1/employees/${e.id}/sensitive`, { method: 'PUT', body }),
    onSuccess: (data) => {
      client.setQueryData(employeeKeys.sensitive(e.id), data);
      setRevealed(null);
      setEditing(false);
      setNotice({ tone: 'success', text: 'Identity and bank details saved.' });
    },
    onError: (err, body) => handle(err, { kind: 'save', body }),
  });
  function handle(err: unknown, retry: Pending) {
    if (err instanceof ApiError && err.code === 'REAUTH_REQUIRED') {
      setPending(retry);
      setNeedsReauth(true);
    } else if (!(retry.kind === 'save' && err instanceof ApiError && err.fieldErrors.length > 0)) {
      setNotice({ tone: 'error', text: errorMessage(err) });
    }
  }

  if (masked.isPending) return <Loading />;
  if (masked.isError) return <Alert tone="error">{errorMessage(masked.error)}</Alert>;
  const shown = revealed ?? masked.data;
  const rows: [string, string | null | undefined][] = [
    ['PAN', shown.pan],
    ['Aadhaar', shown.aadhaar && revealed ? shown.aadhaar.replace(/(\d{4})(?=\d)/g, '$1 ') : shown.aadhaar],
    ['Bank account', shown.bankAccount],
    ['IFSC', shown.bankIfsc],
    ['Bank', shown.bankName],
    ['UAN (provident fund)', shown.uan],
  ];

  return (
    <section
      aria-labelledby="identity-heading"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="identity-heading" className="font-semibold">
          Identity and bank
        </h2>
        <span className="flex gap-2">
          {revealed ? (
            <Button size="sm" variant="outline" onClick={() => setRevealed(null)}>
              Hide numbers
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={reveal.isPending} onClick={() => reveal.mutate()}>
              Show full numbers
            </Button>
          )}
          {e.can.manageSensitive && e.status !== 'EXITED' && (
            <Button size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </span>
      </div>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {needsReauth && pending && (
        <ReauthPrompt
          reason="Confirm it’s you before seeing or changing identity and bank details."
          mfaEnabled={session.user.mfaEnabled}
          onCancel={() => setNeedsReauth(false)}
          onDone={() => {
            setNeedsReauth(false);
            if (pending.kind === 'reveal') reveal.mutate();
            else save.mutate(pending.body);
          }}
        />
      )}
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-mono tabular-nums">
              {value ?? <span className="font-sans text-muted-foreground">Not recorded</span>}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Numbers are stored encrypted. Showing them in full is recorded in the audit log.
      </p>
      {editing && (
        <SensitiveForm
          busy={save.isPending}
          onClose={() => setEditing(false)}
          onSubmit={(body, setError) =>
            save.mutate(body, {
              onError: (err) => {
                applyFieldErrors(err, setError);
              },
            })
          }
          current={masked.data}
        />
      )}
    </section>
  );
}

function SensitiveForm({
  current,
  busy,
  onClose,
  onSubmit,
}: {
  current: SensitiveDetails;
  busy: boolean;
  onClose: () => void;
  onSubmit: (
    body: z.output<typeof employeeSensitiveSchema>,
    setError: (field: never, e: { message: string }) => void,
  ) => void;
}) {
  // Number fields start empty: leaving one empty keeps what is stored.
  const form = useForm<EmployeeSensitiveInput, unknown, z.output<typeof employeeSensitiveSchema>>({
    resolver: zodResolver(employeeSensitiveSchema),
    defaultValues: {
      bankIfsc: current.bankIfsc ?? '',
      bankName: current.bankName ?? '',
      uan: current.uan ?? '',
    },
  });
  const errors = form.formState.errors;
  const keepEmpty = (v: string | undefined) => (v === '' || v === undefined ? undefined : v);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit identity and bank details"
      description="Leave a number empty to keep the one on record."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="sensitive-form" disabled={busy}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="sensitive-form"
        noValidate
        className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4"
        onSubmit={form.handleSubmit((v) =>
          onSubmit(
            {
              ...v,
              pan: keepEmpty(v.pan ?? undefined),
              aadhaar: keepEmpty(v.aadhaar ?? undefined),
              bankAccount: keepEmpty(v.bankAccount ?? undefined),
            },
            form.setError as never,
          ),
        )}
      >
        <Field
          id="s-pan"
          label="PAN"
          error={errors.pan?.message}
          hint={current.pan ? `On record: ${current.pan}` : 'e.g. ABCDE1234F'}
        >
          <Input
            autoComplete="off"
            className="font-mono uppercase"
            {...fieldAria('s-pan', errors.pan?.message, 'hint')}
            {...form.register('pan')}
          />
        </Field>
        <Field
          id="s-aadhaar"
          label="Aadhaar"
          error={errors.aadhaar?.message}
          hint={current.aadhaar ? `On record: ${current.aadhaar}` : '12 digits'}
        >
          <Input
            autoComplete="off"
            inputMode="numeric"
            className="font-mono"
            {...fieldAria('s-aadhaar', errors.aadhaar?.message, 'hint')}
            {...form.register('aadhaar')}
          />
        </Field>
        <Field
          id="s-bankAccount"
          label="Bank account number"
          error={errors.bankAccount?.message}
          hint={current.bankAccount ? `On record: ${current.bankAccount}` : undefined}
        >
          <Input
            autoComplete="off"
            inputMode="numeric"
            className="font-mono"
            {...fieldAria(
              's-bankAccount',
              errors.bankAccount?.message,
              current.bankAccount ? 'hint' : undefined,
            )}
            {...form.register('bankAccount')}
          />
        </Field>
        <Field id="s-bankIfsc" label="IFSC" error={errors.bankIfsc?.message}>
          <Input
            autoComplete="off"
            className="font-mono uppercase"
            {...fieldAria('s-bankIfsc', errors.bankIfsc?.message)}
            {...form.register('bankIfsc')}
          />
        </Field>
        <Field id="s-bankName" label="Bank name" error={errors.bankName?.message}>
          <Input {...fieldAria('s-bankName', errors.bankName?.message)} {...form.register('bankName')} />
        </Field>
        <Field id="s-uan" label="UAN (provident fund)" error={errors.uan?.message}>
          <Input
            autoComplete="off"
            inputMode="numeric"
            className="font-mono"
            {...fieldAria('s-uan', errors.uan?.message)}
            {...form.register('uan')}
          />
        </Field>
      </form>
    </Dialog>
  );
}
