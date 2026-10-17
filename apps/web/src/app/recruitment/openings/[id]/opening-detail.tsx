'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/admin';
import { ApiError, apiFetch } from '@/lib/api';
import { apiUpload } from '@/lib/documents';
import {
  OPENING_STATUS_LABEL,
  OPENING_STATUS_TONE,
  PIPELINE,
  recruitmentKeys,
  STAGE_LABEL,
  STAGE_TONE,
  useApplications,
  useOpening,
  type Application,
  type Opening,
} from '@/lib/recruitment';
import { OpeningDialog } from '../../opening-dialog';

const SOURCES = ['Referral', 'Careers page', 'Job board', 'Agency', 'Campus', 'Walk-in', 'Other'];

export function OpeningDetail({ id }: { id: string }) {
  const opening = useOpening(id);
  const applications = useApplications(id);
  const client = useQueryClient();
  const router = useRouter();
  const [dialog, setDialog] = useState<'edit' | 'candidate' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const refresh = async (o: Opening) => {
    client.setQueryData(recruitmentKeys.opening(id), o);
    await client.invalidateQueries({ queryKey: recruitmentKeys.all });
  };
  const act = useMutation({
    mutationFn: (action: 'submit' | 'OPEN' | 'ON_HOLD' | 'CLOSED') =>
      action === 'submit'
        ? apiFetch<Opening>(`/v1/recruitment/openings/${id}/submit`, { method: 'POST' })
        : apiFetch<Opening>(`/v1/recruitment/openings/${id}/status`, {
            method: 'POST',
            body: { status: action },
          }),
    onSuccess: async (o) => {
      await refresh(o);
      setNotice({
        tone: 'success',
        text:
          o.status === 'PENDING_APPROVAL'
            ? 'Sent for approval.'
            : `Opening is now ${OPENING_STATUS_LABEL[o.status].toLowerCase()}.`,
      });
    },
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  });

  if (opening.isPending) return <Loading />;
  if (opening.isError) return <Alert tone="error">{errorMessage(opening.error)}</Alert>;
  const o = opening.data;
  const rows = applications.data ?? [];
  const closed = rows.filter((r) => r.stage === 'REJECTED' || r.stage === 'WITHDRAWN');

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[13px]">
        <Link href="/recruitment" className="text-primary hover:underline">
          Recruitment
        </Link>{' '}
        <span className="text-muted-foreground">/ {o.code}</span>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{o.title}</h1>
          <p className="text-muted-foreground">
            {[o.company.name, o.branch?.name, o.department?.name, o.designation?.name]
              .filter(Boolean)
              .join(' · ')}
            {o.hiringManager && ` · hiring manager ${o.hiringManager.name}`}
          </p>
          <span className="flex flex-wrap gap-1.5">
            <Badge tone={OPENING_STATUS_TONE[o.status]}>{OPENING_STATUS_LABEL[o.status]}</Badge>
            <Badge>
              {o.hired} of {o.positions} hired
            </Badge>
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {o.can.addCandidates && <Button onClick={() => setDialog('candidate')}>Add candidate</Button>}
          {o.can.submit && (
            <Button disabled={act.isPending} onClick={() => act.mutate('submit')}>
              Send for approval
            </Button>
          )}
          {o.can.edit && o.status !== 'PENDING_APPROVAL' && (
            <Button variant="outline" onClick={() => setDialog('edit')}>
              Edit
            </Button>
          )}
          {o.can.manage && o.status === 'OPEN' && (
            <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate('ON_HOLD')}>
              Put on hold
            </Button>
          )}
          {o.can.manage && o.status === 'ON_HOLD' && (
            <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate('OPEN')}>
              Reopen
            </Button>
          )}
          {o.can.manage && ['OPEN', 'ON_HOLD', 'DRAFT'].includes(o.status) && (
            <Button variant="danger" disabled={act.isPending} onClick={() => act.mutate('CLOSED')}>
              Close
            </Button>
          )}
        </div>
      </header>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {o.status === 'PENDING_APPROVAL' && (
        <Alert tone="info">Waiting for approval. Candidates can be added once it is approved.</Alert>
      )}
      <p className="max-w-3xl text-sm whitespace-pre-wrap">{o.description}</p>

      <section aria-labelledby="pipeline-heading" className="flex flex-col gap-3">
        <h2 id="pipeline-heading" className="text-[17px] font-semibold">
          Pipeline
        </h2>
        {applications.isError && <Alert tone="error">{errorMessage(applications.error)}</Alert>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {PIPELINE.map((stage) => {
            const inStage = rows.filter((r) => r.stage === stage);
            return (
              <section
                key={stage}
                aria-label={STAGE_LABEL[stage]}
                className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3"
              >
                <h3 className="flex items-center justify-between text-[13px] font-semibold">
                  {STAGE_LABEL[stage]}{' '}
                  <span className="text-muted-foreground tabular-nums">{inStage.length}</span>
                </h3>
                {inStage.map((r) => (
                  <Link
                    key={r.id}
                    href={`/recruitment/applications/${r.id}`}
                    className="rounded-md border border-border bg-card px-3 py-2 text-sm hover:border-primary"
                  >
                    <span className="font-medium">{r.candidate.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {r.candidate.source ?? r.candidate.email}
                    </span>
                  </Link>
                ))}
              </section>
            );
          })}
        </div>
        {closed.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Closed ({closed.length})</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {closed.map((r) => (
                <li key={r.id}>
                  <Link href={`/recruitment/applications/${r.id}`} className="text-primary hover:underline">
                    {r.candidate.name}
                  </Link>{' '}
                  <Badge tone={STAGE_TONE[r.stage]}>{STAGE_LABEL[r.stage]}</Badge>{' '}
                  <span className="text-muted-foreground">{r.closedReason}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      {dialog === 'edit' && (
        <OpeningDialog
          opening={o}
          onClose={() => setDialog(null)}
          onDone={async (next) => {
            setDialog(null);
            await refresh(next);
            setNotice({ tone: 'success', text: 'Opening saved.' });
          }}
        />
      )}
      {dialog === 'candidate' && (
        <CandidateDialog
          openingId={id}
          onClose={() => setDialog(null)}
          onDone={(a) => router.push(`/recruitment/applications/${a.id}`)}
        />
      )}
    </>
  );
}

function CandidateDialog({
  openingId,
  onClose,
  onDone,
}: {
  openingId: string;
  onClose: () => void;
  onDone: (a: Application) => void;
}) {
  const client = useQueryClient();
  const [values, setValues] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    source: '',
    notes: '',
  });
  const [resume, setResume] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const set = (patch: Partial<typeof values>) => setValues((v) => ({ ...v, ...patch }));
  const save = useMutation({
    mutationFn: () =>
      resume
        ? apiUpload<Application>(
            `/v1/recruitment/openings/${openingId}/applications`,
            resume,
            values,
            'resume',
          )
        : apiFetch<Application>(`/v1/recruitment/openings/${openingId}/applications`, {
            method: 'POST',
            body: values,
          }),
    onSuccess: async (a) => {
      await client.invalidateQueries({ queryKey: recruitmentKeys.all });
      onDone(a);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.length) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
        if (e.code !== 'VALIDATION_FAILED') setFormError(e.detail);
      } else setFormError(errorMessage(e));
    },
  });
  const text = (key: keyof typeof values, label: string, type = 'text') => (
    <Field id={`cand-${key}`} label={label} error={errors[key]}>
      <Input
        {...fieldAria(`cand-${key}`, errors[key])}
        type={type}
        value={values[key]}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a candidate"
      description="Someone already known by this email is reused, with their earlier history."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="candidate-form" disabled={save.isPending}>
            Add candidate
          </Button>
        </>
      }
    >
      <form
        id="candidate-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setErrors({});
          setFormError(undefined);
          save.mutate();
        }}
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {text('firstName', 'First name')}
          {text('lastName', 'Last name')}
        </div>
        {text('email', 'Email', 'email')}
        {text('phone', 'Phone (optional)', 'tel')}
        <Field id="cand-source" label="Source (optional)">
          <Select id="cand-source" value={values.source} onChange={(e) => set({ source: e.target.value })}>
            <option value="">Not recorded</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="cand-resume" label="Résumé (optional)" hint="PDF, Word (.docx) or text.">
          <input
            id="cand-resume"
            type="file"
            accept=".pdf,.docx,.txt"
            className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:py-2"
            onChange={(e) => setResume(e.target.files?.[0] ?? null)}
          />
        </Field>
        {text('notes', 'Notes (optional)')}
      </form>
    </Dialog>
  );
}
