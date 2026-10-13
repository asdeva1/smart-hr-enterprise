import type { Ref, SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Select({
  className,
  ref,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> }) {
  return (
    <select
      ref={ref}
      className={cn(
        'h-11 w-full rounded-md border border-input bg-card px-3 text-foreground',
        'disabled:cursor-not-allowed disabled:bg-muted aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    />
  );
}
