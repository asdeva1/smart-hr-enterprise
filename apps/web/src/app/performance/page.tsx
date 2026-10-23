'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import {
  CycleDialog,
  FeedbackDialog,
  GoalDialog,
  ManagerReviewDialog,
  SelfReviewDialog,
} from '@/components/performance/dialogs';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import { can, hasFeature } from '@/lib/permissions';
import { formatDate } from '@/lib/plan';
import {
  APPRAISAL_STATUS_LABEL,
  CYCLE_STATUS_LABEL,
  performanceKeys,
  RATING_LABEL,
  type Appraisal,
  type Cycle,
  type FeedbackNote,
  type Goal,
  type MyCycle,
} from '@/lib/performance';

type Tab = 'mine' | 'team' | 'feedback' | 'cycles';

export default function PerformancePage() {
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="Performance" session={session}>
          {hasFeature(session, 'performance') ? (
            <Performance session={session} />
          ) : (
            <Alert tone="info">Your organisation’s plan doesn’t include performance management.</Alert>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}

function Performance({ session }: { session: SessionView }) {
  const runs = can(session, 'performance.view') || can(session, 'performance.manage');
  const [tab, setTab] = useState<Tab>('mine');
  return (
    <>
      <PageHeader
        title="Performance"
        description="Set goals, review the period with your manager, and share feedback with colleagues."
      />
      <Tabs
        label="Performance"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'mine', label: 'My goals and review' },
          { value: 'team', label: 'Reviews I write' },
          { value: 'feedback', label: 'Feedback' },
          ...(runs ? [{ value: 'cycles' as const, label: 'Review cycles' }] : []),
        ]}
      />
      {tab === 'mine' && <Mine />}
      {tab === 'team' && <Team />}
      {tab === 'feedback' && <Feedback />}
      {tab === 'cycles' && runs && <Cycles canManage={can(session, 'performance.manage')} />}
    </>
  );
}

const ratingText = (n: number | null) => (n ? RATING_LABEL[n] : '—');

function statusTone(s: Appraisal['status']) {
  return s === 'ACKNOWLEDGED' ? 'success' : s === 'COMPLETED' ? 'info' : 'warning';
}

// ---- My goals and review ---------------------------------------------------------------------------------

function Mine() {
  const mine = useQuery({
    queryKey: performanceKeys.mine,
    queryFn: () => apiFetch<{ linked: boolean; cycles: MyCycle[] }>('/v1/performance/mine'),
  });
  if (mine.isPending) return <Loading />;
  if (mine.isError) return <Alert tone="error">{errorMessage(mine.error)}</Alert>;
  if (!mine.data.linked) {
    return <Alert tone="info">Your account isn’t linked to an employee record yet. Ask HR to link it.</Alert>;
  }
  if (mine.data.cycles.length === 0) {
    return (
      <EmptyState title="No review cycle yet">
        When HR sets up a review cycle for your company, your goals and review will appear here.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {mine.data.cycles.map((c) => (
        <CycleCard key={c.cycle.id} item={c} />
      ))}
    </div>
  );
}

function CycleCard({ item }: { item: MyCycle }) {
  const { cycle, goals, appraisal } = item;
  const [dialog, setDialog] = useState<'goal' | 'self' | Goal | null>(null);
  const client = useQueryClient();
  const acknowledge = useMutation({
    mutationFn: () => apiFetch(`/v1/performance/appraisals/${appraisal?.id}/acknowledge`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: performanceKeys.all }),
  });
  const live = goals.filter((g) => g.status !== 'DROPPED');
  const used = live.reduce((n, g) => n + g.weight, 0);
  const editable = cycle.status !== 'CLOSED';
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{cycle.name}</h2>
          <p className="text-[13px] text-muted-foreground">
            {formatDate(cycle.periodFrom)} to {formatDate(cycle.periodTo)}
          </p>
        </div>
        <Badge tone={cycle.status === 'OPEN' ? 'success' : 'neutral'}>
          {CYCLE_STATUS_LABEL[cycle.status]}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          Goals · {item.goalProgress}% done · {used} of 100 weight used
        </h3>
        {editable && (
          <Button variant="outline" disabled={used >= 100} onClick={() => setDialog('goal')}>
            Add a goal
          </Button>
        )}
      </div>
      {goals.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          {editable ? 'You haven’t set any goals for this cycle yet.' : 'No goals were set.'}
        </p>
      ) : (
        <Table label={`Goals for ${cycle.name}`}>
          <thead>
            <tr>
              <Th>Goal</Th>
              <Th>Weight</Th>
              <Th>Progress</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {goals.map((g) => (
              <tr key={g.id}>
                <Td>
                  <p className="font-medium">{g.title}</p>
                  {g.description && <p className="text-xs text-muted-foreground">{g.description}</p>}
                </Td>
                <Td>{g.weight}</Td>
                <Td>{g.status === 'ACHIEVED' ? '100%' : `${g.progress}%`}</Td>
                <Td>
                  <Badge
                    tone={g.status === 'ACHIEVED' ? 'success' : g.status === 'DROPPED' ? 'neutral' : 'info'}
                  >
                    {g.status === 'ACHIEVED'
                      ? 'Achieved'
                      : g.status === 'DROPPED'
                        ? 'Dropped'
                        : 'In progress'}
                  </Badge>
                </Td>
                <Td className="text-right">
                  {editable && g.status !== 'DROPPED' && (
                    <Button variant="ghost" onClick={() => setDialog(g)}>
                      Update
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <h3 className="font-semibold">Your review</h3>
      {!appraisal ? (
        <p className="text-[13px] text-muted-foreground">
          Your review starts when HR opens this cycle. You can set goals before then.
        </p>
      ) : (
        <div className="flex flex-col gap-2 rounded-md bg-muted p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(appraisal.status)}>{APPRAISAL_STATUS_LABEL[appraisal.status]}</Badge>
            {appraisal.reviewer && (
              <span className="text-[13px] text-muted-foreground">Reviewer: {appraisal.reviewer.name}</span>
            )}
          </div>
          {appraisal.selfRating && (
            <p className="text-[13px]">
              <strong>You:</strong> {ratingText(appraisal.selfRating)}
              {appraisal.selfComment ? ` — ${appraisal.selfComment}` : ''}
            </p>
          )}
          {appraisal.managerRating && (
            <p className="text-[13px]">
              <strong>Your manager:</strong> {ratingText(appraisal.managerRating)}
              {appraisal.managerComment ? ` — ${appraisal.managerComment}` : ''}
            </p>
          )}
          {acknowledge.isError && <Alert tone="error">{errorMessage(acknowledge.error)}</Alert>}
          <div className="flex gap-2">
            {appraisal.status === 'AWAITING_SELF' && cycle.status === 'OPEN' && (
              <Button onClick={() => setDialog('self')}>Write my review</Button>
            )}
            {appraisal.status === 'COMPLETED' && (
              <Button disabled={acknowledge.isPending} onClick={() => acknowledge.mutate()}>
                Acknowledge my review
              </Button>
            )}
          </div>
        </div>
      )}

      {dialog === 'goal' && (
        <GoalDialog cycleId={cycle.id} remainingWeight={100 - used} onClose={() => setDialog(null)} />
      )}
      {dialog && typeof dialog === 'object' && (
        <GoalDialog
          cycleId={cycle.id}
          goal={dialog}
          remainingWeight={100 - used}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'self' && appraisal && (
        <SelfReviewDialog appraisal={appraisal} onClose={() => setDialog(null)} />
      )}
    </section>
  );
}

// ---- Reviews I write -------------------------------------------------------------------------------------

function Team() {
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({
    queryKey: performanceKeys.toReview,
    queryFn: () => apiFetch<Appraisal[]>('/v1/performance/to-review'),
  });
  if (list.isPending) return <Loading />;
  if (list.isError) return <Alert tone="error">{errorMessage(list.error)}</Alert>;
  if (list.data.length === 0) {
    return (
      <EmptyState title="Nothing waiting for you">
        Reviews appear here once the people who report to you have submitted their own.
      </EmptyState>
    );
  }
  return (
    <>
      <Table label="Reviews waiting for you">
        <thead>
          <tr>
            <Th>Person</Th>
            <Th>Cycle</Th>
            <Th>Their rating</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {list.data.map((a) => (
            <tr key={a.id}>
              <Td className="font-medium">{a.employee?.name}</Td>
              <Td>{a.cycle.name}</Td>
              <Td>{ratingText(a.selfRating)}</Td>
              <Td className="text-right">
                <Button onClick={() => setOpen(a.id)}>Write review</Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {open && <ManagerReviewDialog appraisalId={open} onClose={() => setOpen(null)} />}
    </>
  );
}

// ---- Feedback --------------------------------------------------------------------------------------------

function Feedback() {
  const [giving, setGiving] = useState(false);
  const notes = useQuery({
    queryKey: performanceKeys.feedback,
    queryFn: () => apiFetch<{ received: FeedbackNote[]; given: FeedbackNote[] }>('/v1/performance/feedback'),
  });
  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setGiving(true)}>Give feedback</Button>
      </div>
      {notes.isPending ? (
        <Loading />
      ) : notes.isError ? (
        <Alert tone="error">{errorMessage(notes.error)}</Alert>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <NoteList title="Feedback for you" notes={notes.data.received} who="from" />
          <NoteList title="Feedback you gave" notes={notes.data.given} who="to" />
        </div>
      )}
      {giving && <FeedbackDialog onClose={() => setGiving(false)} />}
    </>
  );
}

function NoteList({ title, notes, who }: { title: string; notes: FeedbackNote[]; who: 'from' | 'to' }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {notes.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nothing yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {notes.map((n) => (
            <li key={n.id} className="border-b border-muted pb-3 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={n.kind === 'PRAISE' ? 'success' : 'info'}>
                  {n.kind === 'PRAISE' ? 'Praise' : 'Suggestion'}
                </Badge>
                <span className="text-[13px] text-muted-foreground">
                  {who === 'from' ? 'From' : 'To'} {(who === 'from' ? n.from : n.to)?.name} ·{' '}
                  {formatDate(n.createdAt)}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap">{n.message}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---- Review cycles (HR) ----------------------------------------------------------------------------------

function Cycles({ canManage }: { canManage: boolean }) {
  const client = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const cycles = useQuery({
    queryKey: performanceKeys.cycles,
    queryFn: () => apiFetch<Cycle[]>('/v1/performance/cycles'),
  });
  const step = useMutation({
    mutationFn: (v: { id: string; action: 'open' | 'close' }) =>
      apiFetch(`/v1/performance/cycles/${v.id}/${v.action}`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: performanceKeys.all }),
  });
  return (
    <>
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}>New review cycle</Button>
        </div>
      )}
      {step.isError && <Alert tone="error">{errorMessage(step.error)}</Alert>}
      {cycles.isPending ? (
        <Loading />
      ) : cycles.isError ? (
        <Alert tone="error">{errorMessage(cycles.error)}</Alert>
      ) : cycles.data.length === 0 ? (
        <EmptyState title="No review cycles yet">
          Create a cycle for a company, then open it to start everyone’s review.
        </EmptyState>
      ) : (
        <Table label="Review cycles">
          <thead>
            <tr>
              <Th>Cycle</Th>
              <Th>Period</Th>
              <Th>Status</Th>
              <Th>Reviews done</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {cycles.data.map((c) => (
              <tr key={c.id}>
                <Td className="font-medium">{c.name}</Td>
                <Td>
                  {formatDate(c.periodFrom)} to {formatDate(c.periodTo)}
                </Td>
                <Td>
                  <Badge tone={c.status === 'OPEN' ? 'success' : 'neutral'}>
                    {CYCLE_STATUS_LABEL[c.status]}
                  </Badge>
                </Td>
                <Td>{c.status === 'DRAFT' ? '—' : `${c.completed} of ${c.people}`}</Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-2">
                    {c.status !== 'DRAFT' && (
                      <Button variant="outline" onClick={() => setViewing(viewing === c.id ? null : c.id)}>
                        {viewing === c.id ? 'Hide reviews' : 'See reviews'}
                      </Button>
                    )}
                    {canManage && c.status === 'DRAFT' && (
                      <Button
                        disabled={step.isPending}
                        onClick={() => step.mutate({ id: c.id, action: 'open' })}
                      >
                        Open cycle
                      </Button>
                    )}
                    {canManage && c.status === 'OPEN' && (
                      <Button
                        variant="outline"
                        disabled={step.isPending}
                        onClick={() => step.mutate({ id: c.id, action: 'close' })}
                      >
                        Close cycle
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {viewing && <CycleReviews cycleId={viewing} />}
      {adding && <CycleDialog onClose={() => setAdding(false)} />}
    </>
  );
}

function CycleReviews({ cycleId }: { cycleId: string }) {
  const list = useQuery({
    queryKey: performanceKeys.appraisals(cycleId),
    queryFn: () => apiFetch<Appraisal[]>(`/v1/performance/cycles/${cycleId}/appraisals`),
  });
  if (list.isPending) return <Loading />;
  if (list.isError) return <Alert tone="error">{errorMessage(list.error)}</Alert>;
  return (
    <Table label="Reviews in this cycle">
      <thead>
        <tr>
          <Th>Person</Th>
          <Th>Reviewer</Th>
          <Th>Goals done</Th>
          <Th>Own rating</Th>
          <Th>Manager rating</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {list.data.map((a) => (
          <tr key={a.id}>
            <Td className="font-medium">{a.employee?.name}</Td>
            <Td>{a.reviewer?.name ?? 'HR'}</Td>
            <Td>{a.goals.length ? `${a.goalProgress}%` : '—'}</Td>
            <Td>{a.selfRating ?? '—'}</Td>
            <Td>{a.managerRating ?? '—'}</Td>
            <Td>
              <Badge tone={statusTone(a.status)}>{APPRAISAL_STATUS_LABEL[a.status]}</Badge>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
