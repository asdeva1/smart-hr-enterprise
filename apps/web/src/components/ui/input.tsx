import type { InputHTMLAttributes, Ref } from 'react';
import { cn } from '@/lib/utils';

export function Input({
  className,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-11 w-full rounded-md border border-input bg-card px-3 text-foreground placeholder:text-muted-foreground',
        'disabled:cursor-not-allowed disabled:bg-muted aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    />
  );
}
