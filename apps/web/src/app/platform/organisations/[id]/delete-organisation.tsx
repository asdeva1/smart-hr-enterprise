'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ReauthPrompt } from '@/components/reauth-prompt';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/admin';
import { ApiError, apiFetch } from '@/lib/api';
import { planKeys } from '@/lib/plan';

interface Result {
  name: string;
  accountsDeleted: number;
  records: number;
  files: { removed: number; failed: number };
}

/** Permanently deletes an organisation. Asks for the address, a reason and the operator's password. */
export function DeleteOrganisation({
  tenant,
  mfaEnabled,
}: {
  tenant: { id: string; name: string; slug: string };
  mfaEnabled: boolean;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmSlug, setConfirmSlug] = useState('');
  const [reason, setReason] = useState('');
  const [deleteAccounts, setDeleteAccounts] = useState(false);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(false);
  const [done, setDone] = useState<Result>();

  const remove = useMutation({
    mutationFn: () =>
      apiFetch<Result>(`/v1/platform/tenants/${tenant.id}/delete`, {
        method: 'POST',
        body: { confirmSlug, reason, deleteAccounts },
      }),
    onSuccess: async (r) => {
      setDone(r);
      await client.invalidateQueries({ queryKey: planKeys.tenants });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'REAUTH_REQUIRED') setRetry(true);
      else setError(errorMessage(e));
    },
  });
  const ready = confirmSlug === tenant.slug && reason.trim().length >= 3;
  const close = () => {
    setOpen(false);
    setConfirmSlug('');
    setReason('');
    setDeleteAccounts(false);
    setError(undefined);
  };

  return (
    <section
      aria-labelledby="delete-heading"
      className="flex flex-col gap-3 rounded-lg border border-danger/40 bg-card p-5"
    >
      <h2 id="delete-heading" className="font-semibold text-danger">
        Delete organisation
      </h2>
      <p className="text-sm text-muted-foreground">
        Permanently removes {tenant.name} and everything in it: employees, payroll, books, invoices, documents
        and its subscription. This cannot be undone. Archiving is the way to keep the data.
      </p>
      <div>
        <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
          Delete this organisation…
        </Button>
      </div>

      {open && !done && (
        <Dialog
          open
          onClose={close}
          title={`Delete ${tenant.name}?`}
          description="Everything is removed at once and cannot be recovered."
          footer={
            <>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button variant="danger" disabled={!ready || remove.isPending} onClick={() => remove.mutate()}>
                {remove.isPending ? 'Deleting…' : 'Delete permanently'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            {error && <Alert tone="error">{error}</Alert>}
            {retry && (
              <ReauthPrompt
                reason="Confirm it’s you before permanently deleting an organisation."
                mfaEnabled={mfaEnabled}
                onCancel={() => setRetry(false)}
                onDone={() => {
                  setRetry(false);
                  remove.mutate();
                }}
              />
            )}
            <Field id="delete-slug" label={`Type ${tenant.slug} to confirm`}>
              <Input
                id="delete-slug"
                className="font-mono"
                autoComplete="off"
                value={confirmSlug}
                onChange={(e) => setConfirmSlug(e.target.value)}
              />
            </Field>
            <Field id="delete-reason" label="Reason (kept in the platform audit log)">
              <Input id="delete-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={deleteAccounts}
                onChange={(e) => setDeleteAccounts(e.target.checked)}
              />
              <span>
                Also delete sign-in accounts that belong only to this organisation, so the same email address
                can sign up again. Operators and people in other organisations are never deleted.
              </span>
            </label>
          </div>
        </Dialog>
      )}

      {done && (
        <Dialog
          open
          onClose={() => router.push('/platform/organisations')}
          title={`${done.name} was deleted`}
          footer={
            <Button onClick={() => router.push('/platform/organisations')}>Back to organisations</Button>
          }
        >
          <p className="text-sm">
            Removed {done.records} records and {done.files.removed} stored files
            {done.accountsDeleted > 0 ? `, and ${done.accountsDeleted} sign-in account(s)` : ''}.
          </p>
          {done.files.failed > 0 && (
            <Alert tone="warning">
              {done.files.failed} stored file(s) could not be removed from storage. They are encrypted and no
              longer linked to anything; remove them from the storage bucket under {tenant.id}/.
            </Alert>
          )}
        </Dialog>
      )}
    </section>
  );
}
