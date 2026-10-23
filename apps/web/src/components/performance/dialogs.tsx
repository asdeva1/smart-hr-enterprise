'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { errorMessage, useCompanies } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { performanceKeys, RATING_LABEL, type Appraisal, type Goal, type PersonRef } from '@/lib/performance';

function useSave(request: () => Promise<unknown>, onDone: () => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: performanceKeys.all });
      onDone();
    },
  });
}

function Footer({
  onClose,
  onSave,
  disabled,
  label = 'Save',
}: {
  onClose: () => void;
  onSave: () => void;
  disabled: boolean;
  label?: string;
}) {
  return (
    <>
      <Button variant="outline" onClick={onClose}>
        Cancel
      </Button>
      <Button disabled={disabled} onClick={onSave}>
        {label}
      </Button>
    </>
  );
}

const Rating = ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => (
  <Field id={id} label="Rating">
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a rating</option>
      {[5, 4, 3, 2, 1].map((n) => (
        <option key={n} value={n}>
          {RATING_LABEL[n]}
        </option>
      ))}
    </Select>
  </Field>
);

export function CycleDialog({ onClose }: { onClose: () => void }) {
  const companies = useCompanies();
  const [f, setF] = useState({ companyId: '', name: '', periodFrom: '', periodTo: '' });
  const companyId = f.companyId || companies.data?.[0]?.id || '';
  const save = useSave(
    () => apiFetch('/v1/performance/cycles', { method: 'POST', body: { ...f, companyId } }),
    onClose,
  );
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <Dialog
      open
      onClose={onClose}
      title="New review cycle"
      description="Set up the period first. Nobody is asked to review anything until you open it."
      footer={
        <Footer
          onClose={onClose}
          onSave={() => save.mutate()}
          disabled={save.isPending || !companyId || f.name.trim().length < 2 || !f.periodFrom || !f.periodTo}
          label="Create cycle"
        />
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <Field id="c-company" label="Company">
          <Select id="c-company" value={companyId} onChange={set('companyId')}>
            {companies.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="c-name" label="Name" hint="For example, Annual review 2026-27">
          <Input id="c-name" value={f.name} onChange={set('name')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="c-from" label="Period starts">
            <Input id="c-from" type="date" value={f.periodFrom} onChange={set('periodFrom')} />
          </Field>
          <Field id="c-to" label="Period ends">
            <Input id="c-to" type="date" value={f.periodTo} onChange={set('periodTo')} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

/** Add a goal, or change one. */
export function GoalDialog({
  cycleId,
  employeeId,
  goal,
  remainingWeight,
  onClose,
}: {
  cycleId: string;
  employeeId?: string | undefined;
  goal?: Goal | undefined;
  /** Weight not yet used by the person's other goals. */
  remainingWeight: number;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(goal?.title ?? '');
  const [description, setDescription] = useState(goal?.description ?? '');
  const [weight, setWeight] = useState(String(goal?.weight ?? Math.min(remainingWeight, 25)));
  const [progress, setProgress] = useState(String(goal?.progress ?? 0));
  const save = useSave(
    () =>
      goal
        ? apiFetch(`/v1/performance/goals/${goal.id}`, {
            method: 'PATCH',
            body: { title, description, weight: Number(weight), progress: Number(progress) },
          })
        : apiFetch('/v1/performance/goals', {
            method: 'POST',
            body: { cycleId, employeeId, title, description, weight: Number(weight) },
          }),
    onClose,
  );
  const w = Number(weight);
  const available = remainingWeight + (goal && goal.status !== 'DROPPED' ? goal.weight : 0);
  return (
    <Dialog
      open
      onClose={onClose}
      title={goal ? 'Update goal' : 'Add a goal'}
      footer={
        <Footer
          onClose={onClose}
          onSave={() => save.mutate()}
          disabled={save.isPending || title.trim().length < 3 || !(w >= 1 && w <= available)}
        />
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <Field id="g-title" label="Goal">
          <Input id="g-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field id="g-desc" label="What done looks like" hint="Optional">
          <Input id="g-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="g-weight"
            label="Weight"
            hint={`${available} of 100 left. Weights across your goals add up to 100 at most.`}
            error={w > available ? `Only ${available} left` : undefined}
          >
            <Input
              id="g-weight"
              inputMode="numeric"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </Field>
          {goal && (
            <Field id="g-progress" label="Progress (%)">
              <Input
                id="g-progress"
                inputMode="numeric"
                value={progress}
                onChange={(e) => setProgress(e.target.value)}
              />
            </Field>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** The employee rates themselves. */
export function SelfReviewDialog({ appraisal, onClose }: { appraisal: Appraisal; onClose: () => void }) {
  const [rating, setRating] = useState('');
  const [comment, setComment] = useState('');
  const save = useSave(
    () =>
      apiFetch(`/v1/performance/appraisals/${appraisal.id}/self`, {
        method: 'POST',
        body: { rating: Number(rating), comment },
      }),
    onClose,
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Your review · ${appraisal.cycle.name}`}
      description="Rate how the period went and say why. Your manager sees this before they write theirs."
      footer={
        <Footer
          onClose={onClose}
          onSave={() => save.mutate()}
          disabled={save.isPending || !rating || comment.trim().length < 3}
          label="Submit my review"
        />
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <Rating id="s-rating" value={rating} onChange={setRating} />
        <Field id="s-comment" label="How did the period go?">
          <textarea
            id="s-comment"
            rows={5}
            className="w-full rounded-md border border-input bg-card px-3 py-2"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}

/** The manager reads the person's own review and goals, then rates them. */
export function ManagerReviewDialog({ appraisalId, onClose }: { appraisalId: string; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ['performance', 'appraisal', appraisalId],
    queryFn: () => apiFetch<Appraisal>(`/v1/performance/appraisals/${appraisalId}`),
  });
  const [rating, setRating] = useState('');
  const [comment, setComment] = useState('');
  const save = useSave(
    () =>
      apiFetch(`/v1/performance/appraisals/${appraisalId}/review`, {
        method: 'POST',
        body: { rating: Number(rating), comment },
      }),
    onClose,
  );
  const a = detail.data;
  return (
    <Dialog
      open
      onClose={onClose}
      title={a ? `Review ${a.employee?.name ?? ''}` : 'Review'}
      {...(a ? { description: a.cycle.name } : {})}
      footer={
        <Footer
          onClose={onClose}
          onSave={() => save.mutate()}
          disabled={
            save.isPending || !a || a.status !== 'AWAITING_MANAGER' || !rating || comment.trim().length < 3
          }
          label="Complete review"
        />
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        {detail.isError && <Alert tone="error">{errorMessage(detail.error)}</Alert>}
        {a && (
          <>
            <div className="rounded-md bg-muted p-3 text-[13px]">
              <p className="font-semibold">
                Their own review: {a.selfRating ? RATING_LABEL[a.selfRating] : 'not submitted yet'}
              </p>
              {a.selfComment && <p className="mt-1 whitespace-pre-wrap">{a.selfComment}</p>}
              <p className="mt-2 text-muted-foreground">Goal progress: {a.goalProgress}%</p>
              {a.goals.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {a.goals.map((g) => (
                    <li key={g.id}>
                      {g.title} ({g.weight}%) — {g.status === 'ACHIEVED' ? 'achieved' : `${g.progress}% done`}
                      {g.status === 'DROPPED' ? ', dropped' : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Rating id="m-rating" value={rating} onChange={setRating} />
            <Field id="m-comment" label="Your assessment">
              <textarea
                id="m-comment"
                rows={5}
                className="w-full rounded-md border border-input bg-card px-3 py-2"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [toId, setToId] = useState('');
  const [kind, setKind] = useState<'PRAISE' | 'SUGGESTION'>('PRAISE');
  const [message, setMessage] = useState('');
  const people = useQuery({
    queryKey: ['performance', 'people', search],
    queryFn: () => apiFetch<PersonRef[]>(`/v1/performance/people?search=${encodeURIComponent(search)}`),
    enabled: search.trim().length >= 2,
  });
  const save = useSave(
    () => apiFetch('/v1/performance/feedback', { method: 'POST', body: { toId, kind, message } }),
    onClose,
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Give feedback"
      description="Only you and the person you send it to can see this."
      footer={
        <Footer
          onClose={onClose}
          onSave={() => save.mutate()}
          disabled={save.isPending || !toId || message.trim().length < 3}
          label="Send feedback"
        />
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <Field id="f-search" label="Who is it for?" hint="Type at least two letters of their name or code">
          <Input id="f-search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        {people.data && (
          <Field id="f-to" label="Choose a colleague">
            <Select id="f-to" value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">Choose a colleague</option>
              {people.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field id="f-kind" label="Kind">
          <Select id="f-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="PRAISE">Praise</option>
            <option value="SUGGESTION">Suggestion</option>
          </Select>
        </Field>
        <Field id="f-message" label="Your feedback">
          <textarea
            id="f-message"
            rows={4}
            className="w-full rounded-md border border-input bg-card px-3 py-2"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
