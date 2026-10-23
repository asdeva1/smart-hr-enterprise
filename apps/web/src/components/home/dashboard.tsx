'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  BellRing,
  Briefcase,
  CalendarClock,
  CheckCheck,
  FolderKanban,
  Landmark,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { apiFetch, type SessionView } from '@/lib/api';
import { useNotifications, type Notification } from '@/lib/approvals';
import { hasFeature } from '@/lib/permissions';
import { homeKeys, type Home } from '@/lib/home';
import {
  inr,
  overviewKeys,
  type AlertArea,
  type AlertTone,
  type MonthValue,
  type Overview,
  type OverviewAlert,
} from '@/lib/overview';
import { cn } from '@/lib/utils';

const step = (i: number): CSSProperties => ({ ['--i' as string]: i });
const delay = (ms: number): CSSProperties => ({ ['--d' as string]: ms });

// ---- Motion helpers --------------------------------------------------------------------------------------

const formatters = {
  number: (n: number) => Math.round(n).toLocaleString('en-IN'),
  money: (n: number) => inr(n, true),
  hours: (n: number) => `${Math.round(n * 10) / 10} h`,
} as const;

/** A number that counts up to its value once, then stays. Written straight to the page, so it never re-renders. */
function CountUp({ value, kind = 'number' }: { value: number; kind?: keyof typeof formatters }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fmt = formatters[kind];
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = fmt(value);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 1100);
      el.textContent = fmt(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, kind]);
  return <span ref={ref}>{formatters[kind](value)}</span>;
}

const toneDot: Record<AlertTone, string> = {
  danger: 'bg-[#e5584a]',
  warning: 'bg-[#e0a23a]',
  info: 'bg-[#4a9ec9]',
};

function Dot({ tone, live }: { tone: AlertTone; live?: boolean }) {
  return (
    <span className="relative mt-1.5 grid size-2.5 shrink-0 place-items-center">
      {live && (
        <span className={cn('dash-ping absolute inline-flex size-full rounded-full', toneDot[tone])} />
      )}
      <span className={cn('relative inline-flex size-2.5 rounded-full', toneDot[tone])} />
    </span>
  );
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ---- Hero ------------------------------------------------------------------------------------------------

interface Stat {
  label: string;
  icon: LucideIcon;
  value: number;
  kind?: keyof typeof formatters;
  note: string;
  href: string;
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Hero({ session, stats }: { session: SessionView; stats: Stat[] }) {
  const first = session.user.displayName.split(' ')[0];
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <section
      className="dash-rise relative isolate overflow-hidden rounded-xl bg-sidebar p-6 text-white sm:p-8"
      style={step(0)}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="dash-aurora-a absolute -top-24 -left-16 size-[360px] rounded-full bg-[#14907f] opacity-45 blur-3xl" />
        <div className="dash-aurora-b absolute -right-10 -bottom-32 size-[400px] rounded-full bg-[#2c6fb0] opacity-35 blur-3xl" />
      </div>
      <p className="text-sm text-[#9fc3c0]">{today}</p>
      <h1 className="mt-1 text-[28px] font-semibold tracking-tight sm:text-[34px]">
        {greeting()}, {first}
      </h1>
      <p className="text-[#b6c7d3]">{session.activeTenant?.name} · here is where things stand.</p>
      {stats.length > 0 && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s, i) => (
            <Link
              key={s.label}
              href={s.href}
              className="dash-rise dash-sheen group relative overflow-hidden rounded-lg border border-white/12 bg-white/8 p-4 backdrop-blur transition-colors hover:bg-white/14"
              style={step(i + 1)}
            >
              <div className="flex items-center justify-between text-[13px] text-[#b6c7d3]">
                <span>{s.label}</span>
                <s.icon size={16} aria-hidden />
              </div>
              <p className="mt-2 text-[30px] leading-none font-semibold tabular-nums">
                <CountUp value={s.value} kind={s.kind ?? 'number'} />
              </p>
              <p className="mt-2 flex items-center justify-between text-xs text-[#9db1bf]">
                {s.note}
                <ArrowUpRight
                  size={14}
                  aria-hidden
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                />
              </p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

// ---- Notification centre ---------------------------------------------------------------------------------

type Area = 'ALL' | AlertArea;
interface FeedItem {
  key: string;
  area: AlertArea | 'ACCOUNT';
  tone: AlertTone;
  title: string;
  detail: string;
  link: string | null;
  when: string | null;
  unread: boolean;
  urgent: boolean;
}

const AREA_LABEL: Record<Area, string> = { ALL: 'All', HR: 'HR', FINANCE: 'Finance', PROJECTS: 'Projects' };

function feedFrom(alerts: OverviewAlert[], notes: Notification[]): FeedItem[] {
  const fromAlerts = alerts.map<FeedItem>((a) => ({
    key: a.id,
    area: a.area,
    tone: a.tone,
    title: a.title,
    detail: a.detail,
    link: a.link,
    when: null,
    unread: true,
    urgent: a.tone === 'danger',
  }));
  const fromNotes = notes.slice(0, 12).map<FeedItem>((n) => ({
    key: n.id,
    area: n.category.startsWith('subscription') ? 'ACCOUNT' : 'HR',
    tone: 'info',
    title: n.title,
    detail: n.body,
    link: n.link,
    when: n.createdAt,
    unread: !n.readAt,
    urgent: false,
  }));
  return [...fromAlerts, ...fromNotes];
}

function NotificationCentre({ alerts }: { alerts: OverviewAlert[] }) {
  const notes = useNotifications();
  const [area, setArea] = useState<Area>('ALL');
  const feed = feedFrom(alerts, notes.data?.items ?? []);
  const count = (a: Area) => feed.filter((f) => a === 'ALL' || f.area === a).length;
  const shown = feed.filter((f) => area === 'ALL' || f.area === area).slice(0, 8);
  const urgent = feed.filter((f) => f.urgent).length;
  return (
    <section
      className="dash-rise flex flex-col rounded-xl border border-border bg-card"
      style={step(5)}
      aria-labelledby="centre-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 pt-4 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-primary-soft text-primary">
            <BellRing size={18} aria-hidden />
          </span>
          <div>
            <h2 id="centre-title" className="text-[16px] font-semibold">
              Notification centre
            </h2>
            <p className="text-xs text-muted-foreground">
              {urgent > 0 ? `${urgent} urgent right now` : 'Nothing urgent right now'}
            </p>
          </div>
        </div>
        <div role="tablist" aria-label="Notification area" className="flex gap-1 rounded-lg bg-muted p-1">
          {(Object.keys(AREA_LABEL) as Area[]).map((a) => (
            <button
              key={a}
              type="button"
              role="tab"
              aria-selected={a === area}
              onClick={() => setArea(a)}
              className={cn(
                'rounded-md px-3 py-1.5 text-[13px] font-medium text-[#3e4c57] transition-colors',
                a === area && 'bg-card font-semibold text-primary shadow-sm',
              )}
            >
              {AREA_LABEL[a]} <span className="tabular-nums text-muted-foreground">{count(a)}</span>
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="grid place-items-center gap-2 px-6 py-12 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-success-soft text-success">
            <CheckCheck size={22} aria-hidden />
          </span>
          <p className="font-semibold">You’re all caught up</p>
          <p className="max-w-xs text-[13px] text-muted-foreground">
            Overdue invoices, bills, leave waiting for you and project overruns will appear here as they
            happen.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-muted">
          {shown.map((f, i) => {
            const inner = (
              <div className="flex gap-3 px-5 py-3">
                <Dot tone={f.tone} live={f.urgent} />
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate', f.unread ? 'font-semibold' : 'font-medium')}>{f.title}</p>
                  <p className="truncate text-[13px] text-muted-foreground">{f.detail}</p>
                </div>
                <span className="shrink-0 pt-0.5 text-xs text-muted-foreground">
                  {f.when ? timeAgo(f.when) : f.area === 'ACCOUNT' ? 'Account' : AREA_LABEL[f.area]}
                </span>
              </div>
            );
            return (
              <li key={f.key} className="dash-rise" style={step(i * 0.5 + 6)}>
                {f.link ? (
                  <Link href={f.link} className="block transition-colors hover:bg-[#f7f9fa]">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---- Module panels ---------------------------------------------------------------------------------------

function Panel({
  title,
  icon: Icon,
  href,
  index,
  children,
}: {
  title: string;
  icon: LucideIcon;
  href: string;
  index: number;
  children: ReactNode;
}) {
  return (
    <section
      className="dash-rise flex flex-col gap-4 rounded-xl border border-border bg-card p-5"
      style={step(index)}
    >
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <Icon size={17} className="text-primary" aria-hidden />
          {title}
        </h2>
        <Link href={href} className="text-[13px] text-primary underline-offset-2 hover:underline">
          Open
        </Link>
      </div>
      {children}
    </section>
  );
}

function Columns({ data, color }: { data: MonthValue[]; color: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div
      className="flex h-24 items-end gap-2"
      role="img"
      aria-label={data.map((d) => `${d.label} ${d.value}`).join(', ')}
    >
      {data.map((d, i) => (
        <div key={d.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
          <div
            className="dash-column w-full rounded-t-[4px]"
            style={{ ...delay(i * 70), height: `${Math.max(4, (d.value / max) * 100)}%`, background: color }}
          />
          <span className="text-[11px] text-muted-foreground">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warn' | 'good' }) {
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-1 text-xs font-medium',
        tone === 'neutral' && 'bg-muted text-[#3e4c57]',
        tone === 'warn' && 'bg-warning-soft text-warning',
        tone === 'good' && 'bg-success-soft text-success',
      )}
    >
      {children}
    </span>
  );
}

function PeoplePanel({ data }: { data: NonNullable<Overview['hr']> }) {
  return (
    <Panel title="People" icon={Users} href="/employees" index={8}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[36px] leading-none font-semibold tabular-nums">
            <CountUp value={data.headcount} />
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">people in the organisation</p>
        </div>
        <div className="w-[55%] min-w-[150px]">
          <Columns data={data.joinedByMonth} color="#14907f" />
          <p className="mt-1 text-right text-[11px] text-muted-foreground">Joined, last six months</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Pill tone={data.joinedLast30 > 0 ? 'good' : 'neutral'}>{data.joinedLast30} joined this month</Pill>
        {data.onLeaveToday !== null && <Pill>{data.onLeaveToday} on leave today</Pill>}
        {data.pendingLeave !== null && data.pendingLeave > 0 && (
          <Pill tone="warn">{data.pendingLeave} leave requests waiting</Pill>
        )}
        {data.onNotice > 0 && <Pill tone="warn">{data.onNotice} on notice</Pill>}
        {data.openRoles !== null && <Pill>{data.openRoles} open roles</Pill>}
      </div>
    </Panel>
  );
}

function Sparkline({ data }: { data: MonthValue[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const pts = data.map(
    (d, i) => [(i / Math.max(1, data.length - 1)) * 100, 34 - (d.value / max) * 30] as const,
  );
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <div>
      <svg
        viewBox="0 0 100 38"
        preserveAspectRatio="none"
        className="h-16 w-full overflow-visible"
        role="img"
        aria-label={`Invoiced per month: ${data.map((d) => `${d.label} ${inr(d.value, true)}`).join(', ')}`}
      >
        <path d={`${line} L100,38 L0,38 Z`} fill="#14907f" opacity="0.12" />
        <path
          d={line}
          pathLength={1}
          fill="none"
          stroke="#0e6b66"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="dash-draw"
        />
      </svg>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        {data.map((d) => (
          <span key={d.label}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

function MoneyBar({
  label,
  total,
  overdue,
  max,
  tone,
  index,
}: {
  label: string;
  total: number;
  overdue: number;
  max: number;
  tone: string;
  index: number;
}) {
  const pct = (n: number) => `${Math.max(total > 0 ? 3 : 0, (n / max) * 100)}%`;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[13px]">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums">
          <CountUp value={total} kind="money" />
          {overdue > 0 && <span className="ml-2 text-xs text-danger">{inr(overdue, true)} overdue</span>}
        </span>
      </div>
      <div className="relative h-3 overflow-hidden rounded-full bg-muted">
        <div
          className="dash-grow absolute inset-y-0 left-0 rounded-full"
          style={{ ...delay(index * 150), width: pct(total), background: tone }}
        >
          {overdue > 0 && (
            <div
              className="absolute inset-y-0 right-0 rounded-r-full bg-[#e5584a]"
              style={{ width: `${Math.min(100, (overdue / total) * 100)}%` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function MoneyPanel({ data }: { data: NonNullable<Overview['finance']> }) {
  const max = Math.max(1, data.receivables, data.payables);
  return (
    <Panel title="Money" icon={Wallet} href="/finance/invoices" index={9}>
      <div className="flex flex-col gap-3">
        <MoneyBar
          label="To collect"
          total={data.receivables}
          overdue={data.overdueReceivables}
          max={max}
          tone="#14907f"
          index={0}
        />
        <MoneyBar
          label="To pay"
          total={data.payables}
          overdue={data.overduePayables}
          max={max}
          tone="#2c6fb0"
          index={1}
        />
      </div>
      <div>
        <p className="mb-1 text-[13px] font-medium">Invoiced, last six months</p>
        <Sparkline data={data.invoicedByMonth} />
      </div>
      <div className="flex flex-wrap gap-2">
        {data.billsDueThisWeek > 0 && <Pill tone="warn">{data.billsDueThisWeek} bills due this week</Pill>}
        {data.unmatchedBankLines > 0 && <Pill>{data.unmatchedBankLines} bank lines to match</Pill>}
        {data.overdueInvoices === 0 && <Pill tone="good">No overdue invoices</Pill>}
      </div>
    </Panel>
  );
}

function ProjectsPanel({ data }: { data: NonNullable<Overview['projects']> }) {
  const colour = (p: number) => (p > 100 ? '#e5584a' : p >= 85 ? '#e0a23a' : '#14907f');
  return (
    <Panel title="Projects" icon={FolderKanban} href="/projects" index={10}>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[36px] leading-none font-semibold tabular-nums">
            <CountUp value={data.active} />
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">active projects</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {data.overBudget > 0 && <Pill tone="warn">{data.overBudget} over budget</Pill>}
          {data.timeToApproveHours > 0 && <Pill>{data.timeToApproveHours} h to approve</Pill>}
        </div>
      </div>
      {data.busiest.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No active projects yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.busiest.map((p, i) => (
            <li key={p.id}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                <span className="truncate font-medium">{p.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {p.budgetHours ? `${p.loggedHours} of ${p.budgetHours} h` : `${p.loggedHours} h`}
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="dash-grow h-full rounded-full"
                  style={{
                    ...delay(i * 120),
                    width: p.percent === null ? '100%' : `${Math.min(100, Math.max(3, p.percent))}%`,
                    background: p.percent === null ? '#b9c6cf' : colour(p.percent),
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ---- The page --------------------------------------------------------------------------------------------

/** Welcome band with the headline figures, the notification centre, and a panel each for people, money and projects. */
export function Dashboard({ session, personal }: { session: SessionView; personal: ReactNode }) {
  const overview = useQuery({
    queryKey: overviewKeys.overview,
    queryFn: () => apiFetch<Overview>('/v1/me/overview'),
    refetchInterval: 120_000,
  });
  const canHome = hasFeature(session, 'self_service.employee');
  const home = useQuery({
    queryKey: homeKeys.home,
    queryFn: () => apiFetch<Home>('/v1/me/home'),
    enabled: canHome,
  });
  const o = overview.data;

  const stats: Stat[] = [];
  if (o?.hr) {
    stats.push({
      label: 'People',
      icon: Users,
      value: o.hr.headcount,
      note: `${o.hr.joinedLast30} joined this month`,
      href: '/employees',
    });
  }
  if (o?.finance) {
    stats.push({
      label: 'To collect',
      icon: Landmark,
      value: o.finance.receivables,
      kind: 'money',
      note: o.finance.overdueInvoices ? `${o.finance.overdueInvoices} overdue` : 'None overdue',
      href: '/finance/invoices',
    });
  }
  if (o?.projects) {
    stats.push({
      label: 'Active projects',
      icon: Briefcase,
      value: o.projects.active,
      note: o.projects.overBudget ? `${o.projects.overBudget} over budget` : 'All within budget',
      href: '/projects',
    });
  }
  if (o) {
    stats.push({
      label: 'Needs attention',
      icon: CalendarClock,
      value: o.alerts.length,
      note: o.alerts.length ? 'See the notification centre' : 'All clear',
      href: '/approvals',
    });
  }
  const waiting = home.data?.waitingForMe;
  if (waiting && stats.length < 4) {
    stats.push({
      label: 'Waiting for you',
      icon: CheckCheck,
      value: waiting.count,
      note: waiting.overdue ? `${waiting.overdue} overdue` : 'To approve',
      href: '/approvals',
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Hero session={session} stats={stats.slice(0, 4)} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <NotificationCentre alerts={o?.alerts ?? []} />
          {o?.projects && <ProjectsPanel data={o.projects} />}
        </div>
        <div className="flex flex-col gap-5">
          {o?.hr && <PeoplePanel data={o.hr} />}
          {o?.finance && <MoneyPanel data={o.finance} />}
        </div>
      </div>
      {personal}
    </div>
  );
}
