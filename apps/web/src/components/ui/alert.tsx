import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const tones = {
  error: 'border-danger/30 bg-danger-soft text-danger',
  success: 'border-success/30 bg-success-soft text-success',
  warning: 'border-warning/30 bg-warning-soft text-warning',
  info: 'border-info/30 bg-info-soft text-info',
} as const;

/** Errors interrupt screen readers (role=alert); other tones are announced politely (role=status). */
export function Alert({
  tone,
  children,
  className,
}: {
  tone: keyof typeof tones;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-md border px-3.5 py-2.5 text-[13px]', tones[tone], className)}
    >
      {children}
    </div>
  );
}
