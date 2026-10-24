'use client';

import { recordIssuedLicenceSchema, revokeIssuedLicenceSchema } from '@smart-hr/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ReauthPrompt } from '@/components/reauth-prompt';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { ApiError, apiFetch, type SessionView } from '@/lib/api';
import {
  daysText,
  REGISTER_KEY,
  STAGE,
  type IssuedLicenceRow,
  type LicenceRegister,
} from '@/lib/licence-register';
import { formatDate } from '@/lib/plan';

type Notice = { tone: 'success' | 'error'; text: string };

export function LicenceRegisterView({ session }: { session: SessionView }) {
  const client = useQueryClient();
  const register = useQuery({
    queryKey: REGISTER_KEY,
    queryFn: () => apiFetch<LicenceRegister>('/v1/platform/licence-register'),
  });
  const [recording, setRecording] = useState<{ renews?: IssuedLicenceRow } | null>(null);
  const [revoking, setRevoking] = useState<IssuedLicenceRow | null>(null);
  const [notice, setNotice] = useState<Notice>();

  if (register.isPending) return <Loading />;
  if (register.isError) return <Alert tone="error">{errorMessage(register.error)}</Alert>;
  const { licences, renewals, summary } = register.data;
  const chase =
    summary.licencesDue + summary.licencesLapsed + summary.subscriptionsDue + summary.subscriptionsLapsed;

  async function copyLicence(row: IssuedLicenceRow) {
    try {
      const { licence } = await apiFetch<{ licence: string }>(
        `/v1/platform/licence-register/${row.id}/licence`,
      );
      await navigator.clipboard.writeText(licence);
      setNotice({
        tone: 'success',
        text: `Licence for ${row.customerName} copied. Send it to the customer.`,
      });
    } catch (e) {
      setNotice({ tone: 'error', text: errorMessage(e) });
    }
  }

  return (
    <>
      <PageHeader
        title="Licence register"
        description="Every licence you have issued, and every subscription or trial about to end, so nobody lapses by surprise."
        actions={<Button onClick={() => setRecording({})}>Record a licence</Button>}
      />
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {chase > 0 ? (
        <Alert tone="warning">
          {summary.licencesLapsed + summary.subscriptionsLapsed > 0 &&
            `${summary.licencesLapsed + summary.subscriptionsLapsed} already past their end date. `}
          {summary.licencesDue + summary.subscriptionsDue > 0 &&
            `${summary.licencesDue + summary.subscriptionsDue} end within 60 days. `}
          Contact these customers about renewing.
        </Alert>
      ) : (
        <Alert tone="success">Nothing needs renewing in the next 60 days.</Alert>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="issued-heading">
        <h2 id="issued-heading" className="text-[15px] font-semibold">
          Issued licences
        </h2>
        {licences.length === 0 ? (
          <p className="text-muted-foreground">
            No licences recorded yet. After you issue one with the licence tool, record it here to track its
            renewal.
          </p>
        ) : (
          <Table label="Issued licences">
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Plan</Th>
                <Th>Expires</Th>
                <Th>State</Th>
                <Th>Notes</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {licences.map((l) => (
                <tr key={l.id}>
                  <Td>
                    <b>{l.customerName}</b>
                    {!l.signatureChecked && (
                      <div className="text-xs text-muted-foreground">
                        Signature not checked on this server
                      </div>
                    )}
                  </Td>
                  <Td>{l.planName}</Td>
                  <Td>
                    {formatDate(l.expiresAt)}
                    <div className="text-xs text-muted-foreground">{daysText(l.daysLeft)}</div>
                  </Td>
                  <Td>
                    <Badge tone={l.renewedById && l.status === 'ACTIVE' ? 'neutral' : STAGE[l.stage].tone}>
                      {l.renewedById && l.status === 'ACTIVE' ? 'Renewed' : STAGE[l.stage].text}
                    </Badge>
                    {l.revokedReason && (
                      <div className="text-xs text-muted-foreground">{l.revokedReason}</div>
                    )}
                  </Td>
                  <Td className="max-w-[240px] text-[13px] text-muted-foreground">{l.notes ?? '—'}</Td>
                  <Td>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button variant="outline" onClick={() => void copyLicence(l)}>
                        Copy licence
                      </Button>
                      {l.status === 'ACTIVE' && !l.renewedById && (
                        <Button variant="outline" onClick={() => setRecording({ renews: l })}>
                          Record renewal
                        </Button>
                      )}
                      {l.status === 'ACTIVE' && (
                        <Button variant="ghost" onClick={() => setRevoking(l)}>
                          Revoke
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="hosted-heading">
        <h2 id="hosted-heading" className="text-[15px] font-semibold">
          Hosted subscriptions and trials ending
        </h2>
        {renewals.length === 0 ? (
          <p className="text-muted-foreground">No hosted organisation is within 60 days of its end date.</p>
        ) : (
          <Table label="Subscriptions and trials ending">
            <thead>
              <tr>
                <Th>Organisation</Th>
                <Th>Plan</Th>
                <Th>Ends</Th>
                <Th>State</Th>
              </tr>
            </thead>
            <tbody>
              {renewals.map((r) => (
                <tr key={r.tenantId}>
                  <Td>
                    <a className="font-semibold underline" href={`/platform/organisations/${r.tenantId}`}>
                      {r.organisation}
                    </a>
                  </Td>
                  <Td>
                    {r.plan} {r.kind === 'TRIAL' ? '(trial)' : ''}
                  </Td>
                  <Td>
                    {formatDate(r.endsAt)}
                    <div className="text-xs text-muted-foreground">{daysText(r.daysLeft)}</div>
                  </Td>
                  <Td>
                    <Badge tone={STAGE[r.stage].tone}>{STAGE[r.stage].text}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      {recording && (
        <RecordDialog
          session={session}
          renews={recording.renews}
          onClose={() => setRecording(null)}
          onDone={(text) => {
            setRecording(null);
            setNotice({ tone: 'success', text });
            void client.invalidateQueries({ queryKey: REGISTER_KEY });
          }}
        />
      )}
      {revoking && (
        <RevokeDialog
          session={session}
          row={revoking}
          onClose={() => setRevoking(null)}
          onDone={() => {
            setRevoking(null);
            setNotice({ tone: 'success', text: 'Licence revoked. It stays in the register.' });
            void client.invalidateQueries({ queryKey: REGISTER_KEY });
          }}
        />
      )}
    </>
  );
}

function RecordDialog({
  session,
  renews,
  onClose,
  onDone,
}: {
  session: SessionView;
  renews: IssuedLicenceRow | undefined;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string>();
  const [needsReauth, setNeedsReauth] = useState(false);
  const save = useMutation({
    mutationFn: (body: { licence: string; notes?: string | undefined; renews?: string | undefined }) =>
      apiFetch<{ signatureChecked: boolean }>('/v1/platform/licence-register', { method: 'POST', body }),
    onSuccess: (r) =>
      onDone(
        r.signatureChecked
          ? 'Licence recorded.'
          : 'Licence recorded. This server has no key to check its signature, so it was read but not verified.',
      ),
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'REAUTH_REQUIRED') setNeedsReauth(true);
      else setError(e instanceof ApiError ? e.detail : errorMessage(e));
    },
  });
  const submit = () => {
    const parsed = recordIssuedLicenceSchema.safeParse({
      licence: text,
      ...(notes.trim() ? { notes } : {}),
      ...(renews ? { renews: renews.id } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    save.mutate(parsed.data);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={renews ? `Record renewal for ${renews.customerName}` : 'Record a licence'}
      description="Paste the licence you issued with the licence tool. The signing key never goes on this server."
      footer={
        needsReauth ? undefined : (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={save.isPending || !text.trim()} onClick={submit}>
              Record licence
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <Field
          id="rec-licence"
          label="Licence"
          error={error}
          hint="Paste the whole text, starting with SHRL1."
        >
          <textarea
            rows={4}
            spellCheck={false}
            {...fieldAria('rec-licence', error, 'hint')}
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs break-all"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <Field id="rec-notes" label="Notes (optional)" hint="For example the contract or who to contact.">
          <Input id="rec-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {needsReauth && (
          <ReauthPrompt
            reason="Confirm it’s you before changing the licence register."
            mfaEnabled={session.user.mfaEnabled}
            onCancel={() => setNeedsReauth(false)}
            onDone={() => {
              setNeedsReauth(false);
              submit();
            }}
          />
        )}
      </div>
    </Dialog>
  );
}

function RevokeDialog({
  session,
  row,
  onClose,
  onDone,
}: {
  session: SessionView;
  row: IssuedLicenceRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [needsReauth, setNeedsReauth] = useState(false);
  const revoke = useMutation({
    mutationFn: (body: { reason: string }) =>
      apiFetch(`/v1/platform/licence-register/${row.id}/revoke`, { method: 'POST', body }),
    onSuccess: onDone,
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'REAUTH_REQUIRED') setNeedsReauth(true);
      else setError(e instanceof ApiError ? e.detail : errorMessage(e));
    },
  });
  const submit = () => {
    const parsed = revokeIssuedLicenceSchema.safeParse({ reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    revoke.mutate(parsed.data);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Revoke the licence for ${row.customerName}?`}
      description="This marks it revoked in the register and keeps the record. An installation that already has the licence keeps working until it expires, because licences are checked offline."
      footer={
        needsReauth ? undefined : (
          <>
            <Button variant="outline" onClick={onClose}>
              Keep it
            </Button>
            <Button variant="danger" disabled={revoke.isPending} onClick={submit}>
              Revoke licence
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <Field id="rev-reason" label="Reason" error={error}>
          <Input
            {...fieldAria('rev-reason', error)}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {needsReauth && (
          <ReauthPrompt
            reason="Confirm it’s you before revoking a licence."
            mfaEnabled={session.user.mfaEnabled}
            onCancel={() => setNeedsReauth(false)}
            onDone={() => {
              setNeedsReauth(false);
              submit();
            }}
          />
        )}
      </div>
    </Dialog>
  );
}
