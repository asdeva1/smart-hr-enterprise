'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { EmptyState, Loading } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { formatDay, todayIso } from '@/lib/employees';
import {
  ASSIGNEE_LABEL,
  recruitmentKeys,
  useOnboardingPlans,
  useOnboardingTemplates,
  type OnboardingPlan,
} from '@/lib/recruitment';

/** One employee's onboarding checklist(s), and starting one, on their record. */
export function OnboardingPanel({ employeeId }: { employeeId: string }) {
  const plans = useOnboardingPlans(employeeId);
  const client = useQueryClient();
  const canStart = plans.data?.can.start ?? false;
  const templates = useOnboardingTemplates(canStart);
  const [templateId, setTemplateId] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const refresh = () => client.invalidateQueries({ queryKey: recruitmentKeys.onboarding });
  const start = useMutation({
    mutationFn: () =>
      apiFetch<OnboardingPlan>(`/v1/onboarding/employees/${employeeId}`, {
        method: 'POST',
        body: { templateId },
      }),
    onSuccess: async () => {
      await refresh();
      setNotice({ tone: 'success', text: 'Onboarding started. Everyone with a task has been told.' });
    },
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  });

  if (plans.isPending) return <Loading />;
  if (plans.isError) return <Alert tone="error">{errorMessage(plans.error)}</Alert>;
  const active = plans.data.plans.find((p) => p.status === 'ACTIVE');
  return (
    <section aria-label="Onboarding" className="flex flex-col gap-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {canStart && !active && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-64">
            <Field id="start-template" label="Checklist">
              <Select id="start-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Choose a checklist</option>
                {(templates.data ?? [])
                  .filter((t) => t.status === 'ACTIVE')
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          <Button disabled={!templateId || start.isPending} onClick={() => start.mutate()}>
            Start onboarding
          </Button>
        </div>
      )}
      {plans.data.plans.length === 0 ? (
        <EmptyState title="No onboarding yet" />
      ) : (
        plans.data.plans.map((p) => <PlanView key={p.id} plan={p} onChanged={refresh} />)
      )}
    </section>
  );
}

export function PlanView({ plan, onChanged }: { plan: OnboardingPlan; onChanged: () => Promise<unknown> }) {
  const [error, setError] = useState<string>();
  const update = useMutation({
    mutationFn: (v: { taskId: string; status: 'DONE' | 'SKIPPED' | 'OPEN' }) =>
      apiFetch<OnboardingPlan>(`/v1/onboarding/tasks/${v.taskId}`, {
        method: 'POST',
        body: { status: v.status },
      }),
    onSuccess: () => onChanged(),
    onError: (e) => setError(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: () => apiFetch(`/v1/onboarding/plans/${plan.id}/cancel`, { method: 'POST' }),
    onSuccess: () => onChanged(),
    onError: (e) => setError(errorMessage(e)),
  });
  const today = todayIso();
  return (
    <article
      aria-label={`Onboarding: ${plan.templateName ?? ''}`}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{plan.templateName}</p>
          <p className="text-[13px] text-muted-foreground">
            From {formatDay(plan.startDate)} · {plan.progress.done} of {plan.progress.total} done
          </p>
        </div>
        <span className="flex items-center gap-2">
          <Badge
            tone={plan.status === 'ACTIVE' ? 'info' : plan.status === 'COMPLETED' ? 'success' : 'neutral'}
          >
            {plan.status === 'ACTIVE'
              ? 'In progress'
              : plan.status === 'COMPLETED'
                ? 'Complete'
                : 'Cancelled'}
          </Badge>
          {plan.can.cancel && (
            <Button size="sm" variant="ghost" onClick={() => cancel.mutate()}>
              Cancel onboarding
            </Button>
          )}
        </span>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className="h-full bg-primary"
          style={{ width: `${plan.progress.total ? (100 * plan.progress.done) / plan.progress.total : 0}%` }}
        />
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {plan.tasks.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className={t.status !== 'OPEN' ? 'text-muted-foreground line-through' : undefined}>
              {t.title}
              <span className="block text-xs text-muted-foreground no-underline">
                {ASSIGNEE_LABEL[t.assignee]}
                {t.assigneeName && ` (${t.assigneeName})`} · due{' '}
                <span
                  className={t.status === 'OPEN' && t.dueDate < today ? 'font-medium text-danger' : undefined}
                >
                  {formatDay(t.dueDate)}
                </span>
                {t.completedBy && ` · ${t.status === 'SKIPPED' ? 'skipped' : 'done'} by ${t.completedBy}`}
              </span>
            </span>
            {t.canUpdate && (
              <span className="flex gap-1.5">
                {t.status === 'OPEN' ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Mark “${t.title}” done`}
                      onClick={() => update.mutate({ taskId: t.id, status: 'DONE' })}
                    >
                      Done
                    </Button>
                    {plan.can.manage && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => update.mutate({ taskId: t.id, status: 'SKIPPED' })}
                      >
                        Skip
                      </Button>
                    )}
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => update.mutate({ taskId: t.id, status: 'OPEN' })}
                  >
                    Reopen
                  </Button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </article>
  );
}
