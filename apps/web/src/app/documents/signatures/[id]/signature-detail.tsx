'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ReauthPrompt } from '@/components/reauth-prompt';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading } from '@/components/ui/page-header';
import { errorMessage } from '@/lib/admin';
import { ApiError, apiFetch, type SessionView } from '@/lib/api';
import {
  documentKeys,
  fileUrl,
  formatWhen,
  SIGNATURE_STATUS_LABEL,
  SIGNATURE_STATUS_TONE,
  SIGNER_STATUS_LABEL,
  useSignature,
  type SignatureRequest,
} from '@/lib/documents';

const linkButton =
  'inline-flex h-10 items-center rounded-md border border-input bg-card px-4 text-sm font-medium hover:bg-muted';

/**
 * One signature request: the document, who signs in what order, and — for the signer whose turn it is —
 * reading the document, agreeing to sign electronically and typing their name.
 */
export function SignatureDetail({ id, session }: { id: string; session: SessionView }) {
  const request = useSignature(id);
  const client = useQueryClient();
  const [name, setName] = useState(session.user.displayName);
  const [consent, setConsent] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const refresh = (r: SignatureRequest) => client.setQueryData(documentKeys.signature(id), r);

  const sign = useMutation({
    mutationFn: () =>
      apiFetch<SignatureRequest>(`/v1/signatures/${id}/sign`, {
        method: 'POST',
        body: { signedName: name, consent },
      }),
    onSuccess: async (r) => {
      refresh(r);
      await client.invalidateQueries({ queryKey: documentKeys.all });
      setNotice({
        tone: 'success',
        text:
          r.status === 'COMPLETED'
            ? 'Signed. Everyone has now signed.'
            : 'Signed. The next signer has been told.',
      });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'REAUTH_REQUIRED') setNeedsReauth(true);
      else setNotice({ tone: 'error', text: errorMessage(e) });
    },
  });
  const cancel = useMutation({
    mutationFn: () => apiFetch<SignatureRequest>(`/v1/signatures/${id}/cancel`, { method: 'POST' }),
    onSuccess: async (r) => {
      refresh(r);
      await client.invalidateQueries({ queryKey: documentKeys.all });
      setNotice({ tone: 'success', text: 'Request cancelled. Anyone still to sign has been told.' });
    },
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  });

  if (request.isPending) return <Loading />;
  if (request.isError) return <Alert tone="error">{errorMessage(request.error)}</Alert>;
  const r = request.data;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[13px]">
        <Link href="/documents/signatures" className="text-primary hover:underline">
          Signatures
        </Link>{' '}
        <span className="text-muted-foreground">/ {r.title}</span>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{r.title}</h1>
          <p className="text-muted-foreground">
            For {r.employee.name} · sent {formatWhen(r.createdAt)}
            {r.expiresAt && r.status === 'PENDING' && ` · sign by ${formatWhen(r.expiresAt)}`}
          </p>
          <span>
            <Badge tone={SIGNATURE_STATUS_TONE[r.status]}>{SIGNATURE_STATUS_LABEL[r.status]}</Badge>
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={fileUrl(`/v1/signatures/${id}/document`)} className={linkButton}>
            Download document
          </a>
          {r.hasSignedCopy && (
            <a href={fileUrl(`/v1/signatures/${id}/signed`)} className={linkButton}>
              Download signed copy
            </a>
          )}
          {r.can.cancel && (
            <Button variant="danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              Cancel request
            </Button>
          )}
        </div>
      </header>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {r.message && (
        <blockquote className="rounded-md border-l-4 border-primary bg-card px-4 py-3 text-sm">
          {r.message}
        </blockquote>
      )}

      {r.can.sign && (
        <section
          aria-labelledby="sign-heading"
          className="flex max-w-xl flex-col gap-4 rounded-lg border border-border bg-card p-5"
        >
          <h2 id="sign-heading" className="text-[17px] font-semibold">
            Your signature
          </h2>
          <p className="text-[13px] text-muted-foreground">
            Download and read the document first. Signing records your typed name, the time, your network
            address and the document’s fingerprint (SHA-256), on a certificate added to the signed copy.
          </p>
          {needsReauth ? (
            <ReauthPrompt
              reason="Confirm it’s you before signing."
              mfaEnabled={session.user.mfaEnabled}
              onCancel={() => setNeedsReauth(false)}
              onDone={() => {
                setNeedsReauth(false);
                sign.mutate();
              }}
            />
          ) : (
            <>
              <Field id="signed-name" label="Type your full name">
                <Input {...fieldAria('signed-name')} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                I have read this document and agree to sign it electronically. My typed name is my signature.
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={!consent || name.trim().length < 2 || sign.isPending}
                  onClick={() => sign.mutate()}
                >
                  Sign
                </Button>
                <Button variant="outline" onClick={() => setDeclining(true)}>
                  Decline
                </Button>
              </div>
            </>
          )}
        </section>
      )}
      {r.me?.status === 'WAITING' && r.status === 'PENDING' && (
        <Alert tone="info">Someone before you still has to sign. You’ll be told when it’s your turn.</Alert>
      )}

      <section aria-labelledby="signers-heading" className="flex flex-col gap-3">
        <h2 id="signers-heading" className="text-[17px] font-semibold">
          Signers{r.sequential ? ', in order' : ''}
        </h2>
        <ol className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
          {r.signers.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <span>
                <span className="mr-2 text-muted-foreground tabular-nums">{s.position}.</span>
                <span className="font-medium">{s.name}</span>
                <span className="text-muted-foreground"> · {s.email}</span>
                {s.signedAt && (
                  <span className="block text-xs text-muted-foreground">
                    Signed as “{s.signedName}” on {formatWhen(s.signedAt)}
                  </span>
                )}
                {s.declinedAt && (
                  <span className="block text-xs text-danger">
                    Declined on {formatWhen(s.declinedAt)}: {s.declineReason}
                  </span>
                )}
              </span>
              <Badge
                tone={
                  s.status === 'SIGNED'
                    ? 'success'
                    : s.status === 'DECLINED'
                      ? 'danger'
                      : s.status === 'PENDING'
                        ? 'info'
                        : 'neutral'
                }
              >
                {SIGNER_STATUS_LABEL[s.status]}
              </Badge>
            </li>
          ))}
        </ol>
        <p className="text-xs break-all text-muted-foreground">Document SHA-256: {r.documentSha256}</p>
      </section>
      {declining && (
        <DeclineDialog
          id={id}
          onClose={() => setDeclining(false)}
          onDone={async (next) => {
            setDeclining(false);
            refresh(next);
            await client.invalidateQueries({ queryKey: documentKeys.all });
            setNotice({ tone: 'success', text: 'You declined. The sender has been told.' });
          }}
        />
      )}
    </>
  );
}

function DeclineDialog({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: (r: SignatureRequest) => void;
}) {
  const [reason, setReason] = useState('');
  const decline = useMutation({
    mutationFn: () =>
      apiFetch<SignatureRequest>(`/v1/signatures/${id}/decline`, { method: 'POST', body: { reason } }),
    onSuccess: onDone,
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Decline to sign"
      description="The request closes and the sender sees your reason."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Back
          </Button>
          <Button
            variant="danger"
            disabled={reason.trim().length < 3 || decline.isPending}
            onClick={() => decline.mutate()}
          >
            Decline
          </Button>
        </>
      }
    >
      {decline.isError && <Alert tone="error">{errorMessage(decline.error)}</Alert>}
      <Field id="decline-reason" label="Reason">
        <Input id="decline-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Dialog>
  );
}
