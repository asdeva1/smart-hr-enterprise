'use client';

import Link from 'next/link';
import type { SessionView } from '@/lib/api';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/leave', label: 'My leave' },
  { href: '/leave/team', label: 'Team' },
  { href: '/leave/balances', label: 'Balances' },
  { href: '/leave/types', label: 'Leave types', needs: 'leave.configure' },
  { href: '/leave/holidays', label: 'Holidays', needs: 'leave.configure' },
];

/** Section navigation. Team and balances show for everyone: managers see their reporting line there. */
export function LeaveTabs({ session, active }: { session: SessionView; active: string }) {
  const tabs = TABS.filter((t) => !t.needs || can(session, t.needs));
  return (
    <nav aria-label="Leave" className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === active ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 border-transparent px-3.5 py-3 font-medium whitespace-nowrap text-[#3e4c57]',
            t.href === active && 'border-primary font-semibold text-primary',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
