'use client';

import { useEffect, useState } from 'react';
import { AttendanceScreen, DashboardScreen, LeaveScreen, PayrollScreen } from './tour-screens';

const TOUR_MS = 7500;
const tabs = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    blurb: 'Headcount, attendance and leave at a glance, updated live.',
    Screen: DashboardScreen,
  },
  {
    id: 'attendance',
    label: 'Attendance',
    blurb: 'Late arrivals and missed punches surface the moment they happen.',
    Screen: AttendanceScreen,
  },
  {
    id: 'leave',
    label: 'Leave approval',
    blurb: 'One tap to approve. Balances, attendance and payroll update themselves.',
    Screen: LeaveScreen,
  },
  {
    id: 'payroll',
    label: 'Payroll run',
    blurb: 'Salaries and payslips from the attendance you already approved.',
    Screen: PayrollScreen,
  },
] as const;

/** An app window that plays four screens in turn. Hover, focus or a click holds it; reduced motion never auto-plays. */
export function ProductTour() {
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);
  useEffect(() => {
    if (held || reduced) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % tabs.length), TOUR_MS);
    return () => clearTimeout(t);
  }, [index, held, reduced]);

  const active = tabs[index]!;
  const { Screen } = active;
  return (
    <div
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
    >
      <div role="tablist" aria-label="Product screens" className="flex flex-wrap gap-2">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={i === index}
            aria-controls="tour-panel"
            onClick={() => setIndex(i)}
            className={`relative overflow-hidden rounded-md px-4 py-2.5 text-[15px] font-semibold transition-colors ${
              i === index ? 'bg-ink text-white' : 'bg-white text-ink hover:bg-brand-soft'
            }`}
          >
            {t.label}
            {i === index && !held && !reduced && (
              <span
                key={`${index}-${held}`}
                className="t-timer absolute inset-x-0 bottom-0 h-[3px] bg-marigold"
                style={{ '--tour': `${TOUR_MS}ms` } as React.CSSProperties}
                aria-hidden
              />
            )}
          </button>
        ))}
      </div>
      <p className="mt-3 min-h-6 text-muted" aria-live="polite">
        {active.blurb}
      </p>
      <div className="mt-4 overflow-hidden rounded-md border border-line bg-white shadow-xl shadow-ink/10">
        <div className="flex items-center gap-2 border-b border-line bg-paper px-4 py-2.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-[#e0636a]" />
          <span className="size-2.5 rounded-full bg-marigold" />
          <span className="size-2.5 rounded-full bg-done" />
          <span className="ml-3 rounded bg-white px-3 py-0.5 text-[12px] text-muted">
            app.smarthrms.com / {active.id}
          </span>
        </div>
        <div
          id="tour-panel"
          role="tabpanel"
          aria-labelledby={`tab-${active.id}`}
          className="min-h-[360px] bg-paper p-4 sm:p-6"
        >
          <Screen key={active.id} />
        </div>
      </div>
      <p className="mt-2 text-[13px] text-muted">Sample data. Names and figures are invented.</p>
    </div>
  );
}
