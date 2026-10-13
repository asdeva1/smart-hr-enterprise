'use client';

import { cn } from '@/lib/utils';

/** Tabs as a row of toggle buttons; the selected one is marked for assistive technology. */
export function Tabs<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-border">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            '-mb-px border-b-2 border-transparent px-3.5 py-3 font-medium whitespace-nowrap text-[#3e4c57]',
            o.value === value && 'border-primary font-semibold text-primary',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
