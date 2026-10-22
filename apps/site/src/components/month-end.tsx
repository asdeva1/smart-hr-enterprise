import { Check } from 'lucide-react';

/**
 * The hero: a month-end close that finishes itself. Rows tick off in sequence on load (CSS only, once),
 * and the final row is the one thing in marigold, because "payslips sent" is the point of the product.
 */
const rows = [
  ['Attendance locked', '412 of 412 employees'],
  ['Leave and loss-of-pay applied', '31 adjustments'],
  ['Salaries calculated', 'PF, ESI, PT and TDS included'],
  ['Approved by Finance', 'Priya S., 28 Oct'],
  ['Payslips sent', 'to 412 inboxes'],
] as const;

export function MonthEnd() {
  return (
    <div className="rounded-md border border-white/15 bg-ink-soft p-5 text-white shadow-2xl shadow-black/30 sm:p-7">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-display text-xl font-semibold">October close</p>
        <p className="text-sm text-white/60">Runs itself, you review</p>
      </div>
      <ul className="mt-5 divide-y divide-white/10">
        {rows.map(([title, detail], i) => {
          const last = i === rows.length - 1;
          return (
            <li
              key={title}
              style={{ '--i': i } as React.CSSProperties}
              className="close-row flex items-center gap-4 py-3.5"
            >
              <span
                style={{ '--i': i } as React.CSSProperties}
                className={`close-tick grid size-7 shrink-0 place-items-center rounded-full ${
                  last ? 'bg-marigold text-ink' : 'bg-white/15 text-white'
                }`}
              >
                <Check className="size-4" strokeWidth={3} aria-hidden />
              </span>
              <span className="flex-1">
                <span className={`block font-semibold ${last ? 'text-marigold' : ''}`}>{title}</span>
                <span className="block text-sm text-white/60">{detail}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
