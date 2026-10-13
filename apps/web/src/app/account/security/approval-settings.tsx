'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { delegationSchema } from '@smart-hr/validation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { applyFieldErrors, errorMessage, formatDateTime } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { approvalKeys, type Colleague, type Delegation, type NotificationPreference } from '@/lib/approvals';

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-border bg-card p-6">
      <h2 id={id} className="text-[17px] font-semibold">
        {title}
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function EmailPreferences() {
  const client = useQueryClient();
  const prefs = useQuery({
    queryKey: approvalKeys.preferences,
    queryFn: () => apiFetch<NotificationPreference[]>('/v1/notifications/preferences'),
  });
  const save = useMutation({
    mutationFn: (body: { category: string; emailEnabled: boolean }) =>
      apiFetch('/v1/notifications/preferences', { method: 'PUT', body }),
    // Show the change straight away; put it back if saving fails.
    onMutate: async (body) => {
      await client.cancelQueries({ queryKey: approvalKeys.preferences });
      const previous = client.getQueryData<NotificationPreference[]>(approvalKeys.preferences);
      client.setQueryData<NotificationPreference[]>(approvalKeys.preferences, (list) =>
        list?.map((p) => (p.category === body.category ? { ...p, emailEnabled: body.emailEnabled } : p)),
      );
      return { previous };
    },
    onError: (_e, _body, context) => client.setQueryData(approvalKeys.preferences, context?.previous),
    onSettled: () => client.invalidateQueries({ queryKey: approvalKeys.preferences }),
  });

  return (
    <Section
      id="email-preferences"
      title="Email notifications"
      description="You always see notifications in Smart HR. Choose which ones also come by email, for this organisation."
    >
      {prefs.isPending ? (
        <Loading />
      ) : prefs.isError ? (
        <Alert tone="error">{errorMessage(prefs.error)}</Alert>
      ) : (
        <ul className="flex flex-col gap-3">
          {prefs.data.map((p) => (
            <li key={p.category}>
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={p.emailEnabled}
                  onChange={(e) => save.mutate({ category: p.category, emailEnabled: e.target.checked })}
                />
                {p.label}
              </label>
            </li>
          ))}
        </ul>
      )}
      {save.isError && (
        <Alert tone="error" className="mt-3">
          {errorMessage(save.error)}
        </Alert>
      )}
    </Section>
  );
}

/** Date inputs give local dates; the API takes instants. A delegation runs from the start of its first day to the end of its last. */
const delegationForm = z
  .object({
    toMembershipId: z.string().min(1, 'Choose who approves for you'),
    from: z.iso.date('Choose a start date'),
    until: z.iso.date('Choose an end date'),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.until >= v.from, { path: ['until'], message: 'End on or after the start' });
type DelegationValues = z.infer<typeof delegationForm>;

export function Delegations() {
  const client = useQueryClient();
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const delegations = useQuery({
    queryKey: approvalKeys.delegations,
    queryFn: () => apiFetch<Delegation[]>('/v1/approvals/delegations'),
  });
  const colleagues = useQuery({
    queryKey: approvalKeys.colleagues(''),
    queryFn: () => apiFetch<Colleague[]>('/v1/approvals/colleagues'),
  });
  const today = new Date().toISOString().slice(0, 10);
  const form = useForm<DelegationValues>({
    resolver: zodResolver(delegationForm),
    defaultValues: { toMembershipId: '', from: today, until: today, reason: '' },
  });

  const create = useMutation({
    mutationFn: (v: DelegationValues) => {
      const body = delegationSchema.parse({
        toMembershipId: v.toMembershipId,
        startsAt: new Date(`${v.from}T00:00:00`).toISOString(),
        endsAt: new Date(`${v.until}T23:59:59`).toISOString(),
        ...(v.reason ? { reason: v.reason } : {}),
      });
      return apiFetch('/v1/approvals/delegations', { method: 'POST', body });
    },
    onSuccess: async () => {
      setNotice({
        tone: 'success',
        text: 'Delegation saved. New approvals go to your delegate during those dates.',
      });
      form.reset({ toMembershipId: '', from: today, until: today, reason: '' });
      await client.invalidateQueries({ queryKey: approvalKeys.delegations });
    },
    onError: (e) => {
      if (e instanceof z.ZodError) {
        setNotice({ tone: 'error', text: e.issues[0]?.message ?? 'Check the dates' });
      } else if (!applyFieldErrors(e, form.setError)) {
        setNotice({ tone: 'error', text: errorMessage(e) });
      }
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/v1/approvals/delegations/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: approvalKeys.delegations }),
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  });
  const errors = form.formState.errors;

  return (
    <Section
      id="delegations"
      title="Approvals while you’re away"
      description="Hand new approvals to a colleague for a period. Requests already waiting for you stay with you."
    >
      <div className="flex flex-col gap-5">
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
        {delegations.isPending ? (
          <Loading />
        ) : delegations.isError ? (
          <Alert tone="error">{errorMessage(delegations.error)}</Alert>
        ) : delegations.data.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {delegations.data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={d.direction === 'given' ? 'info' : 'neutral'}>
                  {d.direction === 'given' ? `To ${d.to}` : `From ${d.from}`}
                </Badge>
                <span>
                  {formatDateTime(d.startsAt)} – {formatDateTime(d.endsAt)}
                </span>
                {d.reason && <span className="text-muted-foreground">· {d.reason}</span>}
                {d.direction === 'given' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(d.id)}
                  >
                    End<span className="sr-only"> delegation to {d.to}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        <form
          noValidate
          onSubmit={form.handleSubmit((v) => {
            setNotice(undefined);
            create.mutate(v);
          })}
          className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] items-end gap-3"
        >
          <Field id="delegate-to" label="Delegate to" error={errors.toMembershipId?.message}>
            <Select
              {...fieldAria('delegate-to', errors.toMembershipId?.message)}
              {...form.register('toMembershipId')}
            >
              <option value="">Choose a colleague</option>
              {colleagues.data?.map((c) => (
                <option key={c.membershipId} value={c.membershipId}>
                  {c.displayName}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="delegate-from" label="From" error={errors.from?.message}>
            <Input
              type="date"
              {...fieldAria('delegate-from', errors.from?.message)}
              {...form.register('from')}
            />
          </Field>
          <Field id="delegate-until" label="Until" error={errors.until?.message}>
            <Input
              type="date"
              {...fieldAria('delegate-until', errors.until?.message)}
              {...form.register('until')}
            />
          </Field>
          <Field id="delegate-reason" label="Reason (optional)">
            <Input {...fieldAria('delegate-reason')} {...form.register('reason')} />
          </Field>
          <div>
            <Button type="submit" disabled={create.isPending}>
              Delegate
            </Button>
          </div>
        </form>
      </div>
    </Section>
  );
}
