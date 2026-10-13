import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** A data table in a horizontally scrolling card, so wide tables never break the page on small screens. */
export function Table({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[640px] border-collapse text-left" aria-label={label}>
        {children}
      </table>
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-border bg-[#f7f9fa] px-4 py-2.5 text-xs font-semibold whitespace-nowrap text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('border-b border-muted px-4 py-3 align-middle', className)} {...props} />;
}
