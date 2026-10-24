'use client';

import Link from 'next/link';
import type { SessionView } from '@/lib/api';
import { can, hasFeature } from '@/lib/permissions';
import { cn } from '@/lib/utils';

const TABS: { href: string; label: string; needs?: string[]; feature?: string }[] = [
  { href: '/attendance', label: 'My attendance' },
  { href: '/attendance/team', label: 'Team' },
  { href: '/attendance/register', label: 'Monthly register' },
  { href: '/attendance/shifts', label: 'Shifts', needs: ['attendance.configure', 'attendance.manage'] },
  {
    href: '/attendance/roster',
    label: 'Rosters',
    needs: ['attendance.manage'],
    feature: 'attendance.advanced',
  },
  {
    href: '/attendance/overtime',
    label: 'Overtime',
    needs: ['attendance.manage'],
    feature: 'attendance.advanced',
  },
  {
    href: '/attendance/rules',
    label: 'Rules',
    needs: ['attendance.configure'],
    feature: 'attendance.advanced',
  },
  { href: '/attendance/biometric', label: 'Biometric', needs: ['attendance.configure'] },
  { href: '/leave/holidays', label: 'Holidays', needs: ['leave.configure'] },
];

/** Section navigation. Team and register show for everyone: managers see their reporting line there. */
export function AttendanceTabs({ session, active }: { session: SessionView; active: string }) {
  const tabs = TABS.filter(
    (t) =>
      (!t.needs || t.needs.some((p) => can(session, p))) && (!t.feature || hasFeature(session, t.feature)),
  );
  return (
    <nav aria-label="Attendance" className="flex gap-1 overflow-x-auto border-b border-border">
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
