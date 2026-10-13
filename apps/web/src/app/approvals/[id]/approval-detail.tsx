'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { approvalDecisionSchema, type ApprovalDecisionInput } from '@smart-hr/validation';
import Link from 'next/link';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { applyFieldErrors, errorMessage, formatDateTime } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { approvalKeys, formatAmount, STATUS_LABEL, STATUS_TONE, type RequestDetail } from '@/lib/approvals';

export function ApprovalDetail({ id }: { id: string }) {
  const client = useQueryClient();
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const request = useQuery({
    queryKey: approvalKeys.request(id),
    queryFn: () => apiFetch<RequestDetail>(`/v1/approvals/requests/${id}`),
  });

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: approvalKeys.all });
    await client.invalidateQueries({ queryKey: approvalKeys.notifications });
  };

  const requesterAction = useMutation({
    mutationFn: (action: 'cancel' | 'resubmit') =>
      apiFetch<{ status: string }>(`/v1/approvals/requests/${id}/${action}`, { method: 'POST' }),
    onSuccess: async (_data, action) => {
      setNotice({
        tone: 'success',
        text:
          action === 'cancel' ? 'Your request was withdrawn.' : 'Your request was sent for approval again.',
      });
      await refresh();
    },
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  });

  if (request.isPending) return <Loading />;
  if (request.isError) {
    return (
      <>
        <PageHeader title="Approval" />
        <Alert tone="error">{errorMessage(request.error)}</Alert>
        <Link href="/approvals" className="text-primary underline">
          Back to approvals
        </Link>
      </>
    );
  }

  const r = request.data;
  const myTask = r.tasks.find((t) => t.isMine && t.status === 'PENDING' && t.round === r.round);
  const rounds = [...new Set(r.tasks.map((t) => t.round))].sort((a, b) => b - a);

  return (
    <>
      <div>
        <Link href="/approvals" className="text-[13px] text-primary hover:underline">
          ← Approvals
        </Link>
      </div>
      <PageHeader
        title={r.title}
        description={
          <>
            {r.subjectLabel} from {r.requestedBy.user.displayName} · submitted {formatDateTime(r.createdAt)}
          </>
        }
        actions={<Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>}
      />
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <section aria-labelledby="request-facts" className="rounded-lg border border-border bg-card p-6">
        <h2 id="request-facts" className="sr-only">
          Details
        </h2>
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
          <Fact label="Amount" value={formatAmount(r.amount, r.currency)} mono />
          <Fact label="Policy" value={`${r.policy.name} (v${r.policy.version})`} />
          <Fact label="Round" value={String(r.round)} />
          <Fact label="Decided" value={formatDateTime(r.decidedAt)} />
        </dl>
      </section>

      {myTask && <DecisionForm taskId={myTask.id} onDone={refresh} onNotice={setNotice} />}

      {r.isMine && (r.status === 'PENDING' || r.status === 'RETURNED') && (
        <div className="flex flex-wrap gap-2.5">
          {r.status === 'RETURNED' && (
            <Button disabled={requesterAction.isPending} onClick={() => requesterAction.mutate('resubmit')}>
              Resubmit
            </Button>
          )}
          <Button
            variant="danger"
            disabled={requesterAction.isPending}
            onClick={() => requesterAction.mutate('cancel')}
          >
            Withdraw request
          </Button>
        </div>
      )}

      <section aria-labelledby="approval-trail" className="flex flex-col gap-4">
        <h2 id="approval-trail" className="text-[17px] font-semibold">
          Approval trail
        </h2>
        {rounds.map((round) => (
          <div key={round} className="rounded-lg border border-border bg-card">
            {rounds.length > 1 && (
              <p className="border-b border-border px-6 py-2.5 text-[13px] font-semibold text-muted-foreground">
                Round {round}
              </p>
            )}
            <ol className="flex flex-col">
              {r.stages.map((stage, index) => {
                const tasks = r.tasks.filter((t) => t.round === round && t.stage === index);
                return (
                  <li
                    key={index}
                    className="flex flex-col gap-2 border-b border-muted px-6 py-4 last:border-b-0"
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-semibold">
                        {index + 1}. {stage.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {stage.mode === 'ALL' ? 'Everyone must approve' : 'Any one approver'}
                        {stage.minAmount !== null && ` · from ${formatAmount(stage.minAmount, r.currency)}`}
                      </span>
                    </div>
                    {tasks.length === 0 ? (
                      <p className="text-[13px] text-muted-foreground">
                        {r.status === 'PENDING' && round === r.round && index > r.currentStage
                          ? 'Not started yet'
                          : 'Not needed for this request'}
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {tasks.map((t) => (
                          <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                            <span>{t.assignee}</span>
                            {t.delegated && <Badge tone="info">Delegate</Badge>}
                            <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                            {t.actedAt && (
                              <span className="text-xs text-muted-foreground">
                                {formatDateTime(t.actedAt)}
                              </span>
                            )}
                            {t.comment && (
                              <q className="w-full text-[13px] text-muted-foreground">{t.comment}</q>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </section>
    </>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono tabular-nums' : undefined}>{value}</dd>
    </div>
  );
}

function DecisionForm({
  taskId,
  onDone,
  onNotice,
}: {
  taskId: string;
  onDone: () => Promise<void>;
  onNotice: (n: { tone: 'success' | 'error'; text: string }) => void;
}) {
  const form = useForm<ApprovalDecisionInput>({
    resolver: zodResolver(approvalDecisionSchema),
    defaultValues: { decision: 'APPROVE', comment: '' },
  });
  const decision = useWatch({ control: form.control, name: 'decision' });
  const decide = useMutation({
    mutationFn: (values: ApprovalDecisionInput) =>
      apiFetch<{ status: string }>(`/v1/approvals/tasks/${taskId}/decision`, {
        method: 'POST',
        body: { decision: values.decision, ...(values.comment ? { comment: values.comment } : {}) },
      }),
    onSuccess: async (_d, values) => {
      onNotice({
        tone: 'success',
        text: {
          APPROVE: 'You approved this request.',
          REJECT: 'You rejected this request.',
          RETURN: 'You sent this request back.',
        }[values.decision],
      });
      await onDone();
    },
    onError: (e) => {
      if (!applyFieldErrors(e, form.setError)) onNotice({ tone: 'error', text: errorMessage(e) });
    },
  });
  const commentError = form.formState.errors.comment?.message;
  const commentHint = decision === 'APPROVE' ? undefined : 'The requester sees this.';

  return (
    <section aria-labelledby="your-decision" className="rounded-lg border border-primary/40 bg-card p-6">
      <h2 id="your-decision" className="text-[17px] font-semibold">
        Your decision
      </h2>
      <form
        noValidate
        className="mt-4 flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) => decide.mutate(values))}
      >
        <fieldset className="flex flex-wrap gap-4">
          <legend className="sr-only">Decision</legend>
          {(
            [
              ['APPROVE', 'Approve'],
              ['RETURN', 'Send back for changes'],
              ['REJECT', 'Reject'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" value={value} {...form.register('decision')} />
              {label}
            </label>
          ))}
        </fieldset>
        <Field
          id="decision-comment"
          label={decision === 'APPROVE' ? 'Comment (optional)' : 'Reason'}
          error={commentError}
          {...(commentHint ? { hint: commentHint } : {})}
        >
          <textarea
            rows={3}
            className="w-full rounded-md border border-input bg-card px-3 py-2 aria-[invalid=true]:border-danger"
            {...fieldAria('decision-comment', commentError, commentHint)}
            {...form.register('comment')}
          />
        </Field>
        <div>
          <Button
            type="submit"
            variant={decision === 'REJECT' ? 'danger' : 'primary'}
            disabled={decide.isPending}
          >
            {{ APPROVE: 'Approve', REJECT: 'Reject', RETURN: 'Send back' }[decision]}
          </Button>
        </div>
      </form>
    </section>
  );
}
