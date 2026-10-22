import { Check, Clock, FileText, Send } from 'lucide-react';
import { CountUp } from './count-up';

/* Sample data only: invented names and figures, drawn in the product's own look. */
const d = (ms: number) => ({ '--d': ms }) as React.CSSProperties;
const inr = (n: number) => `₹${new Intl.NumberFormat('en-IN').format(Math.round(n))}`;

function Panel({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-md border border-line bg-white p-4 ${className}`}>
      <p className="text-[13px] font-semibold text-muted">{title}</p>
      {children}
    </div>
  );
}

export function DashboardScreen() {
  const bars = [62, 74, 58, 81, 90, 70, 86];
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {[
        ['Headcount', 412, 'active employees'],
        ['Present today', 389, 'of 412 checked in'],
        ['On leave', 17, '6 awaiting approval'],
      ].map(([label, n, sub], i) => (
        <div
          key={label as string}
          className="t-in rounded-md border border-line bg-white p-4"
          style={d(i * 120)}
        >
          <p className="text-[13px] font-semibold text-muted">{label}</p>
          <p className="font-display text-4xl font-semibold">
            <CountUp to={n as number} delay={i * 120} />
          </p>
          <p className="text-[13px] text-muted">{sub}</p>
        </div>
      ))}
      <Panel title="Attendance this week" className="sm:col-span-2">
        <div className="mt-3 flex h-32 items-end gap-3">
          {bars.map((h, i) => (
            <div key={i} className="flex h-full flex-1 flex-col items-center gap-1">
              <div className="flex w-full flex-1 items-end">
                <div
                  className="t-bar w-full rounded-sm bg-brand"
                  style={{ height: `${h}%`, ...d(300 + i * 80) }}
                />
              </div>
              <span className="text-[11px] text-muted">{days[i]}</span>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Leave by type">
        <svg viewBox="0 0 42 42" className="mx-auto mt-2 size-28 -rotate-90" aria-hidden>
          <circle cx="21" cy="21" r="15.9" fill="none" stroke="#e8eefb" strokeWidth="6" />
          {[
            ['#1d56c9', 55, 0],
            ['#f2a900', 25, 55],
            ['#17784a', 20, 80],
          ].map(([c, len, off]) => (
            <circle
              key={c as string}
              cx="21"
              cy="21"
              r="15.9"
              fill="none"
              stroke={c as string}
              strokeWidth="6"
              strokeDasharray="100"
              className="t-ring"
              style={
                {
                  '--len': 100,
                  '--off': 100 - (len as number),
                  transform: `rotate(${(off as number) * 3.6}deg)`,
                  transformOrigin: 'center',
                } as React.CSSProperties
              }
            />
          ))}
        </svg>
      </Panel>
    </div>
  );
}

export function AttendanceScreen() {
  const rows = [
    ['Asha Menon', 'Support', '09:02', 'On time', 'ok'],
    ['Rahul Verma', 'Operations', '09:41', 'Late by 41 min', 'warn'],
    ['Neha Kapoor', 'Finance', '08:55', 'On time', 'ok'],
    ['Imran Sheikh', 'Operations', '-', 'Regularisation sent', 'pending'],
    ['Divya Nair', 'People', '09:10', 'On time', 'ok'],
  ] as const;
  const tone = {
    ok: 'bg-[#e6f4ec] text-[#0f5233]',
    warn: 'bg-marigold-soft text-[#7a5200]',
    pending: 'bg-brand-soft text-brand-deep',
  };
  return (
    <div className="rounded-md border border-line bg-white">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="font-display text-lg font-semibold">Today’s attendance</p>
        <p className="flex items-center gap-1.5 text-[13px] text-muted">
          <Clock className="size-4" aria-hidden /> Live
        </p>
      </div>
      <ul className="divide-y divide-line">
        {rows.map(([name, team, time, status, kind], i) => (
          <li key={name} className="t-in flex items-center gap-3 px-4 py-3" style={d(i * 260)}>
            <span className="grid size-9 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand-deep">
              {name
                .split(' ')
                .map((p) => p[0])
                .join('')}
            </span>
            <span className="flex-1">
              <span className="block text-[15px] font-semibold">{name}</span>
              <span className="block text-[13px] text-muted">{team}</span>
            </span>
            <span className="w-14 text-sm tabular-nums text-muted">{time}</span>
            <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${tone[kind]}`}>
              {status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LeaveScreen() {
  return (
    <div className="grid gap-4 sm:grid-cols-[1.3fr_1fr]">
      <div className="t-in rounded-md border border-line bg-white p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-brand-soft font-semibold text-brand-deep">
            RV
          </span>
          <div>
            <p className="font-semibold">Rahul Verma</p>
            <p className="text-[13px] text-muted">Earned leave, 4 to 6 Nov (3 days)</p>
          </div>
          <div className="relative ml-auto h-7 w-24">
            <span
              className="t-swap-out absolute inset-0 grid place-items-center rounded-full bg-marigold-soft text-[12px] font-semibold text-[#7a5200]"
              style={d(0)}
            >
              Pending
            </span>
            <span
              className="t-swap-in absolute inset-0 grid place-items-center rounded-full bg-[#e6f4ec] text-[12px] font-semibold text-[#0f5233]"
              style={d(0)}
            >
              Approved
            </span>
          </div>
        </div>
        <p className="mt-4 rounded-md bg-paper p-3 text-[14px] text-muted">
          Family function in Pune. Handover note shared with Asha.
        </p>
        <div className="mt-4 flex gap-3">
          <span
            className="t-press inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white"
            style={d(0)}
          >
            <Check className="size-4" aria-hidden /> Approve
          </span>
          <span className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-muted">
            Decline
          </span>
        </div>
      </div>
      <Panel title="Leave balance" className="t-in">
        <p className="mt-2 font-display text-4xl font-semibold">
          <span className="relative inline-block h-10 w-12 align-bottom">
            <span className="t-swap-out absolute left-0 top-0" style={d(0)}>
              12
            </span>
            <span className="t-swap-in absolute left-0 top-0" style={d(0)}>
              9
            </span>
          </span>
          <span className="text-base font-normal text-muted"> days left</span>
        </p>
        <p className="mt-2 text-[13px] text-muted">
          Updates the moment it’s approved. Attendance and payroll follow automatically.
        </p>
      </Panel>
    </div>
  );
}

export function PayrollScreen() {
  const steps = [
    'Attendance locked',
    'Leave and loss-of-pay applied',
    'PF, ESI, PT and TDS calculated',
    'Approved by Finance',
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-[1.2fr_1fr]">
      <div className="rounded-md border border-line bg-white p-5">
        <p className="font-display text-lg font-semibold">October payroll</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-brand-soft">
          <div className="t-fill h-full w-full rounded-full bg-brand" />
        </div>
        <ul className="mt-4 space-y-3">
          {steps.map((s, i) => (
            <li key={s} className="t-in flex items-center gap-3 text-[15px]" style={d(500 + i * 650)}>
              <span className="grid size-6 place-items-center rounded-full bg-done text-white">
                <Check className="size-3.5" strokeWidth={3} aria-hidden />
              </span>
              {s}
            </li>
          ))}
          <li className="t-in flex items-center gap-3 text-[15px] font-semibold" style={d(3300)}>
            <span className="grid size-6 place-items-center rounded-full bg-marigold text-ink">
              <Send className="size-3.5" aria-hidden />
            </span>
            Payslips sent to 412 inboxes
          </li>
        </ul>
      </div>
      <div className="t-in rounded-md border border-line bg-white p-5" style={d(900)}>
        <p className="flex items-center gap-2 text-[13px] font-semibold text-muted">
          <FileText className="size-4" aria-hidden /> Payslip, Asha Menon
        </p>
        <dl className="mt-3 space-y-2 text-[15px]">
          {[
            ['Gross', 62000],
            ['PF and ESI', -7440],
            ['Professional Tax', -200],
            ['TDS', -3150],
          ].map(([k, v]) => (
            <div key={k as string} className="flex justify-between">
              <dt className="text-muted">{k}</dt>
              <dd className="tabular-nums">
                {(v as number) < 0 ? '-' : ''}
                {inr(Math.abs(v as number))}
              </dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-line pt-2 font-semibold">
            <dt>Net pay</dt>
            <dd className="font-display text-xl tabular-nums">
              <CountUp to={51210} ms={1600} delay={1200} format={inr} />
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
