import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

const base =
  'inline-flex items-center justify-center gap-2 rounded-md px-5 py-3 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60';
const looks = {
  primary: 'bg-brand text-white hover:bg-brand-deep',
  secondary: 'border border-ink/25 bg-white text-ink hover:border-ink hover:bg-white',
  inverse: 'bg-white text-ink hover:bg-marigold-soft',
} as const;

export function ButtonLink({
  href,
  look = 'primary',
  children,
  className = '',
}: {
  href: string;
  look?: keyof typeof looks;
  children: ReactNode;
  className?: string;
}) {
  const external = /^https?:/.test(href);
  const cls = `${base} ${looks[look]} ${className}`;
  return external ? (
    <a href={href} className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export function Button({
  look = 'primary',
  className = '',
  ...props
}: ComponentProps<'button'> & { look?: keyof typeof looks }) {
  return <button type="button" className={`${base} ${looks[look]} ${className}`} {...props} />;
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[15px] font-medium">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-[#a32317]">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  'w-full rounded-md border border-ink/25 bg-white px-3.5 py-2.5 text-[16px] text-ink placeholder:text-muted/70 focus:border-brand';

export function Notice({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  const cls =
    tone === 'error'
      ? 'border-[#a32317]/30 bg-[#fdeceb] text-[#7d1b12]'
      : 'border-done/30 bg-[#e6f4ec] text-[#0f5233]';
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-md border px-4 py-3 text-[15px] ${cls}`}
    >
      {children}
    </div>
  );
}
