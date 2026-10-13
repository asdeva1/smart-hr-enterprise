import {
  BookOpen,
  CalendarDays,
  ChartColumn,
  CircleCheck,
  Clock,
  FileText,
  Layers,
  LayoutGrid,
  Settings,
  Sparkles,
  Tag,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SessionView } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ShellHeader } from './shell-header';

interface NavItem {
  label: string;
  icon: LucideIcon;
  href?: string;
  /** Phase in which the module ships; items without an href are shown but not yet clickable. */
  phase?: number;
}

const NAV: { section?: string; items: NavItem[] }[] = [
  { items: [{ label: 'Dashboard', icon: LayoutGrid, href: '/' }] },
  {
    section: 'People',
    items: [
      { label: 'Employees', icon: Users, phase: 8 },
      { label: 'Attendance', icon: Clock, phase: 9 },
      { label: 'Leave', icon: CalendarDays, phase: 10 },
      { label: 'Approvals', icon: CircleCheck, phase: 11 },
      { label: 'Payroll', icon: Wallet, phase: 14 },
    ],
  },
  {
    section: 'Business',
    items: [
      { label: 'Finance', icon: BookOpen, phase: 15 },
      { label: 'Operations', icon: Layers, phase: 17 },
      { label: 'Documents', icon: FileText, phase: 12 },
      { label: 'Reports', icon: ChartColumn, phase: 18 },
    ],
  },
  {
    section: 'Admin',
    items: [
      { label: 'AI assistant', icon: Sparkles, phase: 19 },
      { label: 'Plans and billing', icon: Tag, phase: 5 },
      { label: 'Settings', icon: Settings, phase: 3 },
    ],
  },
];

export function AppShell({
  active,
  session,
  children,
}: {
  active: string;
  session: SessionView;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-wrap">
      <nav
        aria-label="Main"
        className="flex flex-[1_1_220px] flex-col gap-0.5 bg-sidebar px-3 pt-5 pb-6 text-sidebar-foreground min-[880px]:max-w-[244px]"
      >
        <div className="flex items-center gap-2.5 px-2.5 pb-4 text-[15px] font-bold text-white">
          <span className="grid size-[30px] place-items-center rounded-md bg-primary font-mono text-[13px]">
            SH
          </span>
          Smart HR
        </div>
        {NAV.map((group) => (
          <div key={group.section ?? 'top'} className="flex flex-col gap-0.5">
            {group.section && (
              <div className="px-2.5 pt-4 pb-1.5 text-[11px] tracking-[0.08em] text-sidebar-muted uppercase">
                {group.section}
              </div>
            )}
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = item.label === active;
              const content = (
                <>
                  <Icon aria-hidden="true" className="size-[18px]" strokeWidth={1.75} />
                  {item.label}
                  {!item.href && item.phase !== undefined && (
                    <span className="ml-auto text-[11px] text-sidebar-muted">Phase {item.phase}</span>
                  )}
                </>
              );
              const classes = cn(
                'flex min-h-10 items-center gap-2.5 rounded-md px-2.5 py-2',
                isActive && 'bg-sidebar-accent font-semibold text-white',
              );
              return item.href ? (
                <Link
                  key={item.label}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(classes, !isActive && 'hover:bg-sidebar-accent/60 hover:text-white')}
                >
                  {content}
                </Link>
              ) : (
                <span key={item.label} aria-disabled="true" className={cn(classes, 'opacity-60')}>
                  {content}
                </span>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="flex min-w-0 flex-[999_1_560px] flex-col">
        <ShellHeader session={session} />
        <main className="flex w-full max-w-[1280px] flex-col gap-6 px-8 pt-7 pb-12">{children}</main>
      </div>
    </div>
  );
}
