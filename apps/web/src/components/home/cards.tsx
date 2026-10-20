'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loading } from '@/components/ui/page-header';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { homeKeys, type Home, type TeamToday } from '@/lib/home';

function Card({ title, href, children }: { title: string; href?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {href && (
          <Link className="text-sm underline" href={href}>
            Open
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

function Today({ home }: { home: Home }) {
  const client = useQueryClient();
  const a = home.attendance;
  const punch = useMutation({
    mutationFn: (direction: 'IN' | 'OUT') =>
      apiFetch('/v1/attendance/me/punch', { method: 'POST', body: { direction } }),
    onSuccess: () => client.invalidateQueries({ queryKey: homeKeys.home }),
  });
  if (!a) return null;
  return (
    <Card title="Today" href="/attendance">
      {a.holiday && <Badge tone="neutral">Holiday: {a.holiday}</Badge>}
      {a.onLeave && <Badge tone="neutral">On leave</Badge>}
      <p className="text-sm text-muted-foreground">
        {a.firstIn ? `You clocked in at ${time(a.firstIn)}.` : 'You haven’t clocked in yet.'}
        {a.openSince ? ' You are clocked in now.' : ''}
      </p>
      {punch.isError && <Alert tone="error">{errorMessage(punch.error)}</Alert>}
      {a.canPunch && (
        <div>
          <Button disabled={punch.isPending} onClick={() => punch.mutate(a.nextAction)}>
            {a.nextAction === 'IN' ? 'Clock in' : 'Clock out'}
          </Button>
        </div>
      )}
    </Card>
  );
}

export function MyHome() {
  const home = useQuery({ queryKey: homeKeys.home, queryFn: () => apiFetch<Home>('/v1/me/home') });
  if (home.isPending) return <Loading />;
  if (home.isError) return <Alert tone="error">{errorMessage(home.error)}</Alert>;
  const h = home.data;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Today home={h} />
      {h.waitingForMe && (
        <Card title="Waiting for you" href="/approvals">
          {h.waitingForMe.count === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to approve.</p>
          ) : (
            <>
              <p className="text-sm">
                {h.waitingForMe.count} to decide
                {h.waitingForMe.overdue > 0 && ` · ${h.waitingForMe.overdue} overdue`}
              </p>
              <ul className="text-sm text-muted-foreground">
                {h.waitingForMe.first.map((t) => (
                  <li key={t.id}>
                    {t.title} · {t.stage}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
      {h.leave && (
        <Card title="Leave" href="/leave">
          <ul className="text-sm">
            {h.leave.balances.map((b) => (
              <li key={b.type} className="flex justify-between gap-2">
                <span>{b.type}</span>
                <span className="tabular-nums">{b.available} days</span>
              </li>
            ))}
          </ul>
          {h.leave.pending > 0 && (
            <p className="text-sm text-muted-foreground">{h.leave.pending} request(s) awaiting approval</p>
          )}
          {h.holidays.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Next holiday: {h.holidays[0]!.name} on {h.holidays[0]!.date}
            </p>
          )}
        </Card>
      )}
      {h.work && (
        <Card title="My work" href="/operations">
          {h.work.open === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing assigned to you.</p>
          ) : (
            <>
              <p className="text-sm">
                {h.work.open} open{h.work.overdue > 0 && ` · ${h.work.overdue} overdue`}
              </p>
              <ul className="text-sm">
                {h.work.items.map((i) => (
                  <li key={i.id}>
                    <Link className="underline" href={`/operations/items/${i.id}`}>
                      {i.ref} · {i.title}
                    </Link>{' '}
                    {i.overdue && <Badge tone="danger">Overdue</Badge>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
      {h.time && (
        <Card title="Time this week" href="/projects">
          <p className="text-2xl font-semibold tabular-nums">{h.time.weekHours} h</p>
        </Card>
      )}
      {h.assets && h.assets.count > 0 && (
        <Card title="Assets with you" href="/assets">
          <p className="text-sm">{h.assets.count} item(s) assigned to you</p>
        </Card>
      )}
    </div>
  );
}

export function TeamCard() {
  const team = useQuery({
    queryKey: homeKeys.team,
    queryFn: () => apiFetch<TeamToday | null>('/v1/me/team'),
  });
  if (team.isPending || team.isError || !team.data || !team.data.counts || team.data.counts.total === 0) {
    return null;
  }
  const t = team.data;
  const c = t.counts!;
  return (
    <Card title="Your team today" href="/attendance">
      <p className="text-sm">
        {c.total} people · {c.present + c.halfDay} in · {c.onLeave} on leave · {c.notIn} not in yet
        {c.late > 0 && ` · ${c.late} late`}
      </p>
      {t.notIn.length > 0 && (
        <p className="text-sm text-muted-foreground">Not in: {t.notIn.map((n) => n.name).join(', ')}</p>
      )}
      {t.onLeave.length > 0 && (
        <p className="text-sm text-muted-foreground">On leave: {t.onLeave.map((n) => n.name).join(', ')}</p>
      )}
      {t.pendingLeave > 0 && (
        <p className="text-sm">
          <Link className="underline" href="/approvals">
            {t.pendingLeave} leave request(s) waiting
          </Link>
        </p>
      )}
    </Card>
  );
}
