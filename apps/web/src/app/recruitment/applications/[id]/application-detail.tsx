'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { PeoplePicker, type PersonOption } from '@/components/people-picker';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/admin';
import { ApiError, apiFetch, type SessionView } from '@/lib/api';
import { fileUrl, fileSize } from '@/lib/documents';
import { formatDay } from '@/lib/employees';
import { can, hasFeature } from '@/lib/permissions';
import {
  money,
  OFFER_STATUS_LABEL,
  RECOMMENDATION_LABEL,
  recruitmentKeys,
  STAGE_LABEL,
  STAGE_TONE,
  useApplication,
  useOnboardingTemplates,
  when,
  type Application,
  type Recommendation,
} from '@/lib/recruitment';

type Mode = 'stage' | 'interview' | 'offer' | 'hire' | { feedback: string } | null;

export function ApplicationDetail({ id, session }: { id: string; session: SessionView }) {
  const app = useApplication(id);
  const client = useQueryClient();
  const [mode, setMode] = useState<Mode>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const done = async (a: Application, text: string) => {
    client.setQueryData(recruitmentKeys.application(id), a);
    await client.invalidateQueries({ queryKey: recruitmentKeys.all });
    setMode(null);
    setNotice({ tone: 'success', text });
  };
  const offerAction = useMutation({
    mutationFn: (v: { offerId: string; action: 'withdraw' | 'ACCEPTED' | 'DECLINED' }) =>
      v.action === 'withdraw'
        ? apiFetch<Application>(`/v1/recruitment/offers/${v.offerId}/withdraw`, { method: 'POST' })
        : apiFetch<Application>(`/v1/recruitment/offers/${v.offerId}/response`, {
            method: 'POST',
            body: { response: v.action },
          }),
    onSuccess: (a, v) =>
      done(
        a,
        v.action === 'withdraw'
          ? 'Offer withdrawn.'
          : v.action === 'ACCEPTED'
            ? 'Offer accepted.'
            : 'Offer declined.',
      ),
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  });
  const interviewAction = useMutation({
    mutationFn: (v: { interviewId: string; status: 'COMPLETED' | 'CANCELLED' }) =>
      apiFetch<Application>(`/v1/recruitment/interviews/${v.interviewId}/status`, {
        method: 'POST',
        body: { status: v.status },
      }),
    onSuccess: (a, v) =>
      done(a, v.status === 'COMPLETED' ? 'Interview marked as done.' : 'Interview cancelled.'),
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  });

  if (app.isPending) return <Loading />;
  if (app.isError) return <Alert tone="error">{errorMessage(app.error)}</Alert>;
  const a = app.data;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[13px]">
        <Link href="/recruitment" className="text-primary hover:underline">
          Recruitment
        </Link>{' '}
        /{' '}
        <Link href={`/recruitment/openings/${a.opening.id}`} className="text-primary hover:underline">
          {a.opening.code}
        </Link>{' '}
        <span className="text-muted-foreground">/ {a.candidate.name}</span>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{a.candidate.name}</h1>
          <p className="text-muted-foreground">
            {a.opening.title} · {a.candidate.email}
            {a.candidate.phone && ` · ${a.candidate.phone}`}
          </p>
          <span>
            <Badge tone={STAGE_TONE[a.stage]}>{STAGE_LABEL[a.stage]}</Badge>
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {a.candidate.resume && (
            <a
              href={fileUrl(`/v1/recruitment/applications/${id}/resume`)}
              className="inline-flex h-10 items-center rounded-md border border-input bg-card px-4 text-sm font-medium hover:bg-muted"
            >
              Download résumé ({fileSize(a.candidate.resume.size)})
            </a>
          )}
          {a.can.move && (
            <Button variant="outline" onClick={() => setMode('stage')}>
              Move stage
            </Button>
          )}
          {a.can.schedule && (
            <Button variant="outline" onClick={() => setMode('interview')}>
              Schedule interview
            </Button>
          )}
          {a.can.offer && <Button onClick={() => setMode('offer')}>Make an offer</Button>}
          {a.can.hire && <Button onClick={() => setMode('hire')}>Hire</Button>}
        </div>
      </header>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {a.hiredEmployeeId && (
        <Alert tone="success">
          Hired.{' '}
          <Link href={`/employees/${a.hiredEmployeeId}`} className="font-semibold underline">
            Open their employee record
          </Link>
        </Alert>
      )}
      {a.closedReason && a.stage !== 'HIRED' && <Alert tone="info">{a.closedReason}</Alert>}

      <section aria-labelledby="interviews-heading" className="flex flex-col gap-3">
        <h2 id="interviews-heading" className="text-[17px] font-semibold">
          Interviews
        </h2>
        {a.interviews.length === 0 && <p className="text-[13px] text-muted-foreground">None yet.</p>}
        {a.interviews.map((i) => (
          <article
            key={i.id}
            aria-label={i.title}
            className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{i.title}</p>
                <p className="text-[13px] text-muted-foreground">
                  {when(i.scheduledAt)} · {i.durationMinutes} min{i.location && ` · ${i.location}`}
                </p>
              </div>
              <span className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={i.status === 'SCHEDULED' ? 'info' : i.status === 'COMPLETED' ? 'success' : 'neutral'}
                >
                  {i.status === 'SCHEDULED' ? 'Scheduled' : i.status === 'COMPLETED' ? 'Done' : 'Cancelled'}
                </Badge>
                {i.canGiveFeedback && (
                  <Button size="sm" onClick={() => setMode({ feedback: i.id })}>
                    Give feedback
                  </Button>
                )}
                {a.can.manage && i.status === 'SCHEDULED' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => interviewAction.mutate({ interviewId: i.id, status: 'COMPLETED' })}
                    >
                      Mark done
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => interviewAction.mutate({ interviewId: i.id, status: 'CANCELLED' })}
                    >
                      Cancel
                    </Button>
                  </>
                )}
              </span>
            </div>
            <ul className="flex flex-col gap-1.5 text-sm">
              {i.feedback.map((f) => (
                <li key={f.id} className="rounded-md bg-muted/40 px-3 py-2">
                  <span className="font-medium">{f.name}</span>{' '}
                  {!f.submitted ? (
                    <span className="text-muted-foreground">· feedback to come</span>
                  ) : f.recommendation ? (
                    <>
                      <span className="text-muted-foreground">
                        · {RECOMMENDATION_LABEL[f.recommendation]}, {f.rating}/5
                      </span>
                      <span className="block whitespace-pre-wrap">{f.comments}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">· given (shown once you give yours)</span>
                  )}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      {a.offers.length > 0 && (
        <section aria-labelledby="offers-heading" className="flex flex-col gap-3">
          <h2 id="offers-heading" className="text-[17px] font-semibold">
            Offers
          </h2>
          {a.offers.map((o) => (
            <article
              key={o.id}
              aria-label="Offer"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 text-sm"
            >
              <div>
                <p className="font-medium">{OFFER_STATUS_LABEL[o.status]}</p>
                <p className="text-muted-foreground">
                  Joining {formatDay(o.joiningDate)} · {money(o.annualCtc, o.currency)} a year
                  {o.decisionNote && ` · “${o.decisionNote}”`}
                </p>
              </div>
              {a.can.manage && (
                <span className="flex flex-wrap gap-2">
                  {o.status === 'APPROVED' && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => offerAction.mutate({ offerId: o.id, action: 'ACCEPTED' })}
                      >
                        Candidate accepted
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => offerAction.mutate({ offerId: o.id, action: 'DECLINED' })}
                      >
                        Candidate declined
                      </Button>
                    </>
                  )}
                  {['PENDING_APPROVAL', 'RETURNED', 'APPROVED'].includes(o.status) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => offerAction.mutate({ offerId: o.id, action: 'withdraw' })}
                    >
                      Withdraw offer
                    </Button>
                  )}
                </span>
              )}
            </article>
          ))}
        </section>
      )}

      <section aria-labelledby="history-heading" className="flex flex-col gap-3">
        <h2 id="history-heading" className="text-[17px] font-semibold">
          History
        </h2>
        <ol className="flex flex-col gap-1.5 text-sm">
          {a.events.map((e) => (
            <li key={e.id}>
              <span className="text-muted-foreground tabular-nums">{when(e.at)}</span> ·{' '}
              {STAGE_LABEL[e.toStage]}
              {e.by && <span className="text-muted-foreground"> by {e.by}</span>}
              {e.note && <span> — {e.note}</span>}
            </li>
          ))}
        </ol>
        {a.candidate.notes && <p className="text-[13px] text-muted-foreground">Notes: {a.candidate.notes}</p>}
      </section>

      {mode === 'stage' && (
        <StageDialog
          app={a}
          onClose={() => setMode(null)}
          onDone={(x) => done(x, `Moved to ${STAGE_LABEL[x.stage]}.`)}
        />
      )}
      {mode === 'interview' && (
        <InterviewDialog
          app={a}
          onClose={() => setMode(null)}
          onDone={(x) => done(x, 'Interview scheduled. The interviewers have been told.')}
        />
      )}
      {mode !== null && typeof mode === 'object' && (
        <FeedbackDialog
          interviewId={mode.feedback}
          onClose={() => setMode(null)}
          onDone={(x) => done(x, 'Thank you — your feedback is saved.')}
        />
      )}
      {mode === 'offer' && (
        <OfferDialog
          app={a}
          onClose={() => setMode(null)}
          onDone={(x) => done(x, 'Offer sent for approval.')}
        />
      )}
      {mode === 'hire' && (
        <HireDialog
          app={a}
          onboarding={hasFeature(session, 'onboarding') && can(session, 'onboarding.manage')}
          onClose={() => setMode(null)}
          onDone={(x) => done(x, 'Hired. Their employee record is ready.')}
        />
      )}
    </>
  );
}

function useAction<T>(path: string, onDone: (a: Application) => void) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const m = useMutation({
    mutationFn: (body: T) => apiFetch<Application>(path, { method: 'POST', body }),
    onSuccess: onDone,
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.length) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      } else setFormError(errorMessage(e));
    },
  });
  return { m, errors, formError, reset: () => (setErrors({}), setFormError(undefined)) };
}

function Footer({
  onClose,
  form,
  label,
  busy,
}: {
  onClose: () => void;
  form: string;
  label: string;
  busy: boolean;
}) {
  return (
    <>
      <Button variant="outline" onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit" form={form} disabled={busy}>
        {label}
      </Button>
    </>
  );
}

function StageDialog({
  app,
  onClose,
  onDone,
}: {
  app: Application;
  onClose: () => void;
  onDone: (a: Application) => void;
}) {
  const [stage, setStage] = useState(app.stage === 'APPLIED' ? 'SCREENING' : 'REJECTED');
  const [note, setNote] = useState('');
  const { m, errors, formError, reset } = useAction<{ stage: string; note: string }>(
    `/v1/recruitment/applications/${app.id}/stage`,
    onDone,
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Move to another stage"
      footer={<Footer onClose={onClose} form="stage-form" label="Move" busy={m.isPending} />}
    >
      <form
        id="stage-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => (e.preventDefault(), reset(), m.mutate({ stage, note }))}
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        <Field id="stage-to" label="Stage">
          <Select id="stage-to" value={stage} onChange={(e) => setStage(e.target.value)}>
            {(['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'] as const)
              .filter((s) => s !== app.stage)
              .map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
          </Select>
        </Field>
        <Field
          id="stage-note"
          label={stage === 'REJECTED' || stage === 'WITHDRAWN' ? 'Reason' : 'Note (optional)'}
          error={errors.note}
        >
          <Input
            {...fieldAria('stage-note', errors.note)}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}

function InterviewDialog({
  app,
  onClose,
  onDone,
}: {
  app: Application;
  onClose: () => void;
  onDone: (a: Application) => void;
}) {
  const [values, setValues] = useState({
    title: `Round ${app.interviews.length + 1}`,
    at: '',
    duration: '60',
    location: '',
  });
  const [people, setPeople] = useState<PersonOption[]>([]);
  const { m, errors, formError, reset } = useAction<object>(
    `/v1/recruitment/applications/${app.id}/interviews`,
    onDone,
  );
  const set = (patch: Partial<typeof values>) => setValues((v) => ({ ...v, ...patch }));
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Schedule an interview with ${app.candidate.name}`}
      description="The interviewers get a notification and an email."
      footer={<Footer onClose={onClose} form="interview-form" label="Schedule" busy={m.isPending} />}
    >
      <form
        id="interview-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          reset();
          m.mutate({
            title: values.title,
            scheduledAt: values.at ? new Date(values.at).toISOString() : '',
            durationMinutes: Number(values.duration),
            location: values.location,
            interviewerMembershipIds: people.map((p) => p.membershipId),
          });
        }}
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        <Field id="iv-title" label="Round" error={errors.title}>
          <Input
            {...fieldAria('iv-title', errors.title)}
            value={values.title}
            onChange={(e) => set({ title: e.target.value })}
          />
        </Field>
        <Field id="iv-at" label="Date and time" error={errors.scheduledAt}>
          <Input
            {...fieldAria('iv-at', errors.scheduledAt)}
            type="datetime-local"
            value={values.at}
            onChange={(e) => set({ at: e.target.value })}
          />
        </Field>
        <Field id="iv-duration" label="Length">
          <Select
            id="iv-duration"
            value={values.duration}
            onChange={(e) => set({ duration: e.target.value })}
          >
            {['30', '45', '60', '90', '120'].map((d) => (
              <option key={d} value={d}>
                {d} minutes
              </option>
            ))}
          </Select>
        </Field>
        <Field id="iv-location" label="Where (optional)" hint="A room or a meeting link.">
          <Input
            id="iv-location"
            value={values.location}
            onChange={(e) => set({ location: e.target.value })}
          />
        </Field>
        <PeoplePicker
          id="iv-people"
          label="Interviewers"
          endpoint="/v1/recruitment/people"
          value={people}
          onChange={setPeople}
        />
        {errors.interviewerMembershipIds && (
          <p className="text-xs text-danger">{errors.interviewerMembershipIds}</p>
        )}
      </form>
    </Dialog>
  );
}

function FeedbackDialog({
  interviewId,
  onClose,
  onDone,
}: {
  interviewId: string;
  onClose: () => void;
  onDone: (a: Application) => void;
}) {
  const [rating, setRating] = useState('');
  const [recommendation, setRecommendation] = useState<Recommendation | ''>('');
  const [comments, setComments] = useState('');
  const { m, errors, formError, reset } = useAction<object>(
    `/v1/recruitment/interviews/${interviewId}/feedback`,
    onDone,
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Your feedback"
      description="Once given it can’t be changed. You’ll see the other interviewers’ feedback after giving yours."
      footer={<Footer onClose={onClose} form="feedback-form" label="Give feedback" busy={m.isPending} />}
    >
      <form
        id="feedback-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => (e.preventDefault(), reset(), m.mutate({ rating, recommendation, comments }))}
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        <Field id="fb-rating" label="Rating" error={errors.rating}>
          <Select
            {...fieldAria('fb-rating', errors.rating)}
            value={rating}
            onChange={(e) => setRating(e.target.value)}
          >
            <option value="">Choose</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} of 5
              </option>
            ))}
          </Select>
        </Field>
        <Field id="fb-rec" label="Recommendation" error={errors.recommendation}>
          <Select
            {...fieldAria('fb-rec', errors.recommendation)}
            value={recommendation}
            onChange={(e) => setRecommendation(e.target.value as Recommendation)}
          >
            <option value="">Choose</option>
            {Object.entries(RECOMMENDATION_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="fb-comments" label="What you saw" error={errors.comments}>
          <textarea
            {...fieldAria('fb-comments', errors.comments)}
            rows={4}
            className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm aria-[invalid=true]:border-danger"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}

function OfferDialog({
  app,
  onClose,
  onDone,
}: {
  app: Application;
  onClose: () => void;
  onDone: (a: Application) => void;
}) {
  const [values, setValues] = useState({ joiningDate: '', annualCtc: '', notes: '' });
  const { m, errors, formError, reset } = useAction<object>(
    `/v1/recruitment/applications/${app.id}/offers`,
    onDone,
  );
  const set = (patch: Partial<typeof values>) => setValues((v) => ({ ...v, ...patch }));
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Offer for ${app.candidate.name}`}
      description="The offer goes for approval first. Record the candidate’s answer once it is approved."
      footer={<Footer onClose={onClose} form="offer-form" label="Send for approval" busy={m.isPending} />}
    >
      <form
        id="offer-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => (e.preventDefault(), reset(), m.mutate(values))}
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        <Field id="of-join" label="Joining date" error={errors.joiningDate}>
          <Input
            {...fieldAria('of-join', errors.joiningDate)}
            type="date"
            value={values.joiningDate}
            onChange={(e) => set({ joiningDate: e.target.value })}
          />
        </Field>
        <Field id="of-ctc" label="Annual CTC (optional)" error={errors.annualCtc}>
          <Input
            {...fieldAria('of-ctc', errors.annualCtc)}
            inputMode="decimal"
            value={values.annualCtc}
            onChange={(e) => set({ annualCtc: e.target.value })}
          />
        </Field>
        <Field id="of-notes" label="Notes (optional)">
          <Input id="of-notes" value={values.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </form>
    </Dialog>
  );
}

function HireDialog({
  app,
  onboarding,
  onClose,
  onDone,
}: {
  app: Application;
  onboarding: boolean;
  onClose: () => void;
  onDone: (a: Application) => void;
}) {
  const templates = useOnboardingTemplates(onboarding);
  const [workEmail, setWorkEmail] = useState('');
  const [templateId, setTemplateId] = useState('');
  const client = useQueryClient();
  const [error, setError] = useState<string>();
  const m = useMutation({
    mutationFn: () =>
      apiFetch<{ application: Application }>(`/v1/recruitment/applications/${app.id}/hire`, {
        method: 'POST',
        body: { workEmail, onboardingTemplateId: templateId || null },
      }),
    onSuccess: async (r) => {
      await client.invalidateQueries({ queryKey: ['employees'] });
      onDone(r.application);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Hire ${app.candidate.name}`}
      description="Makes their employee record from the opening and the accepted offer. Their résumé is kept on the record for HR."
      footer={<Footer onClose={onClose} form="hire-form" label="Hire" busy={m.isPending} />}
    >
      <form
        id="hire-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => (e.preventDefault(), setError(undefined), m.mutate())}
      >
        {error && <Alert tone="error">{error}</Alert>}
        <Field
          id="hire-email"
          label="Work email (optional)"
          hint="They can be invited to sign in with it later."
        >
          <Input
            id="hire-email"
            type="email"
            value={workEmail}
            onChange={(e) => setWorkEmail(e.target.value)}
          />
        </Field>
        {onboarding && (
          <Field id="hire-onboarding" label="Onboarding checklist (optional)">
            <Select id="hire-onboarding" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Don’t start onboarding yet</option>
              {(templates.data ?? [])
                .filter((t) => t.status === 'ACTIVE')
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
      </form>
    </Dialog>
  );
}
