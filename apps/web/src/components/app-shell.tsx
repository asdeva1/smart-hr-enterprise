'use client';

import {
  BookOpen,
  Building,
  Building2,
  CalendarDays,
  ChartColumn,
  CircleCheck,
  Clock,
  DatabaseBackup,
  FileKey,
  FileText,
  KeyRound,
  Laptop,
  Boxes,
  FolderKanban,
  Briefcase,
  Layers,
  LayoutGrid,
  Menu,
  ListChecks,
  ListTodo,
  PackageCheck,
  Receipt,
  ShoppingCart,
  Store,
  Palette,
  ScrollText,
  Plug,
  Settings,
  ShieldCheck,
  ShieldUser,
  Sparkles,
  Tag,
  UserCog,
  Users,
  Wallet,
  X,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { SessionView } from '@/lib/api';
import { can, hasFeature } from '@/lib/permissions';
import { formatDate } from '@/lib/plan';
import { cn } from '@/lib/utils';
import { BrandLogo } from './brand-logo';
import { ShellHeader } from './shell-header';

interface NavItem {
  label: string;
  icon: LucideIcon;
  href?: string;
  /** Phase in which the module ships; items without an href are shown but not yet clickable. */
  phase?: number;
  /** Hidden unless the member holds this permission. The API enforces it regardless. */
  permission?: string;
  /** Hidden unless the organisation's plan includes this feature. The API enforces it regardless. */
  feature?: string;
  /** Only for platform administrators. */
  platform?: boolean;
  /** Only for owners of the active organisation. */
  tenantAdmin?: boolean;
  /** Only in these deployment modes. */
  modes?: SessionView['deploymentMode'][];
}

const NAV: { section?: string; items: NavItem[] }[] = [
  { items: [{ label: 'Dashboard', icon: LayoutGrid, href: '/' }] },
  {
    section: 'People',
    items: [
      {
        label: 'Employees',
        icon: Users,
        href: '/employees',
        permission: 'employees.view',
        feature: 'hr.core',
      },
      { label: 'Attendance', icon: Clock, href: '/attendance', feature: 'attendance.basic' },
      { label: 'Leave', icon: CalendarDays, href: '/leave', feature: 'leave.basic' },
      { label: 'Approvals', icon: CircleCheck, href: '/approvals' },
      { label: 'Recruitment', icon: Briefcase, href: '/recruitment', feature: 'recruitment' },
      { label: 'Onboarding', icon: ListTodo, href: '/onboarding', feature: 'onboarding' },
      { label: 'Payroll', icon: Wallet, href: '/payroll', feature: 'payroll' },
      { label: 'Expenses', icon: Receipt, href: '/expenses', feature: 'expenses' },
    ],
  },
  {
    section: 'Business',
    items: [
      { label: 'Finance', icon: BookOpen, href: '/finance', permission: 'finance.view', feature: 'finance' },
      { label: 'Procurement', icon: ShoppingCart, href: '/procurement', feature: 'procurement' },
      { label: 'Assets', icon: Laptop, href: '/assets', feature: 'assets' },
      {
        label: 'Inventory',
        icon: Boxes,
        href: '/inventory',
        permission: 'inventory.view',
        feature: 'inventory',
      },
      { label: 'Projects', icon: FolderKanban, href: '/projects', feature: 'projects' },
      { label: 'Vendors', icon: Store, href: '/vendors', permission: 'vendors.view', feature: 'vendors' },
      { label: 'Operations', icon: Layers, href: '/operations', feature: 'operations.templates' },
      { label: 'Documents', icon: FileText, href: '/documents', feature: 'documents' },
      { label: 'Reports', icon: ChartColumn, phase: 18 },
    ],
  },
  {
    section: 'Administration',
    items: [
      { label: 'Organisation', icon: Building2, href: '/admin/organisation', permission: 'org.view' },
      { label: 'People and access', icon: UserCog, href: '/admin/people', permission: 'access.view' },
      { label: 'Roles', icon: KeyRound, href: '/admin/roles', permission: 'access.view' },
      {
        label: 'Organisation settings',
        icon: Settings,
        href: '/admin/settings',
        permission: 'settings.manage',
      },
      {
        label: 'Reference lists',
        icon: ListChecks,
        href: '/admin/master-data',
        permission: 'master_data.manage',
      },
      { label: 'Security policy', icon: ShieldCheck, href: '/admin/security', permission: 'security.manage' },
      {
        label: 'Approval policies',
        icon: Workflow,
        href: '/admin/approvals',
        permission: 'approvals.manage',
      },
      { label: 'Audit log', icon: ScrollText, href: '/admin/audit', permission: 'audit.view' },
      { label: 'Plan and usage', icon: Tag, href: '/admin/plan', permission: 'settings.manage' },
      { label: 'Branding', icon: Palette, href: '/admin/branding', permission: 'settings.manage' },
      {
        label: 'Integrations',
        icon: Plug,
        href: '/admin/integrations',
        permission: 'settings.manage',
        feature: 'integrations.custom',
      },
      { label: 'Your data', icon: DatabaseBackup, href: '/admin/data', tenantAdmin: true },
      { label: 'AI assistant', icon: Sparkles, href: '/assistant', feature: 'ai.assistant' },
      {
        label: 'AI controls',
        icon: Sparkles,
        href: '/admin/ai',
        permission: 'settings.manage',
        feature: 'ai.assistant',
      },
    ],
  },
  {
    section: 'Platform',
    items: [
      { label: 'Organisations', icon: Building, href: '/platform/organisations', platform: true },
      {
        label: 'Plan catalogue',
        icon: PackageCheck,
        href: '/platform/plans',
        platform: true,
        modes: ['saas', 'dedicated'],
      },
      { label: 'Licence', icon: FileKey, href: '/platform/licence', platform: true, modes: ['inhouse'] },
      { label: 'Operators', icon: ShieldUser, href: '/platform/operators', platform: true },
    ],
  },
];

function visible(item: NavItem, session: SessionView): boolean {
  if (item.modes && !item.modes.includes(session.deploymentMode)) return false;
  if (item.platform) return session.user.isPlatformAdmin;
  if (item.tenantAdmin && !session.activeTenant?.isTenantAdmin) return false;
  if (item.permission && !can(session, item.permission)) return false;
  if (item.feature && !hasFeature(session, item.feature)) return false;
  return true;
}

export function AppShell({
  active,
  session,
  children,
}: {
  active: string;
  session: SessionView;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const tenant = session.activeTenant;
  const brandName = tenant?.branding.name ?? tenant?.name ?? 'Smart HR';
  // The API only accepts colours dark enough for white text, so overriding the primary token stays accessible.
  const brandStyle = tenant?.branding.color
    ? ({ '--color-primary': tenant.branding.color } as CSSProperties)
    : undefined;
  return (
    <div className="flex min-h-screen flex-wrap" style={brandStyle}>
      <nav
        aria-label="Main"
        className="flex flex-[1_1_220px] flex-col gap-0.5 bg-sidebar px-3 pt-3 pb-3 text-sidebar-foreground min-[880px]:max-w-[244px] min-[880px]:pt-5 min-[880px]:pb-6"
      >
        <div className="flex items-center gap-2.5 px-2.5 py-1 text-[15px] font-bold text-white min-[880px]:pt-0 min-[880px]:pb-4">
          {tenant?.branding.logoUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- an organisation-supplied https URL, not a bundled asset */}
              <img
                src={tenant.branding.logoUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="size-[30px] rounded-md bg-white object-contain"
              />
              <span className="min-w-0 truncate">{brandName}</span>
            </>
          ) : (
            <BrandLogo priority className="w-[170px] min-[880px]:w-[200px]" />
          )}
          {/* Below 880px the menu folds away behind this button, so the page starts at the top of the screen. */}
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="main-menu"
            onClick={() => setMenuOpen((open) => !open)}
            className="ml-auto flex min-h-10 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-semibold hover:bg-sidebar-accent/60 focus-visible:outline-2 focus-visible:outline-white min-[880px]:hidden"
          >
            {menuOpen ? (
              <X aria-hidden="true" className="size-[18px]" />
            ) : (
              <Menu aria-hidden="true" className="size-[18px]" />
            )}
            Menu
          </button>
        </div>
        <div
          id="main-menu"
          className={cn('flex-col gap-0.5 min-[880px]:flex', menuOpen ? 'flex pb-3' : 'hidden')}
        >
          {NAV.map((group) => ({
            ...group,
            items: group.items.filter((item) => visible(item, session)),
          }))
            .filter((group) => group.items.length > 0)
            .map((group) => (
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
        </div>
      </nav>
      <div className="flex min-w-0 flex-[999_1_560px] flex-col">
        <ShellHeader session={session} />
        <OffboardingBanner session={session} />
        <SubscriptionBanner session={session} />
        <main className="flex w-full max-w-[1280px] flex-col gap-6 px-8 pt-7 pb-12">{children}</main>
      </div>
    </div>
  );
}

/** While an organisation is offboarding, everything is read-only so members can still look and export. */
function OffboardingBanner({ session }: { session: SessionView }) {
  if (session.activeTenant?.status !== 'OFFBOARDING') return null;
  return (
    <div
      role="status"
      className="border-b border-danger/30 bg-danger-soft px-8 py-2.5 text-[13px] text-danger"
    >
      This organisation is being closed. Everything is read-only: you can view and export, but not change
      anything.
      {session.activeTenant.isTenantAdmin && (
        <>
          {' '}
          <Link href="/admin/data" className="font-semibold underline">
            Download your data
          </Link>
        </>
      )}
    </div>
  );
}

/** Tells everyone when the organisation's subscription limits what they can do. Data is never hidden. */
function SubscriptionBanner({ session }: { session: SessionView }) {
  const plan = session.activeTenant?.plan;
  if (!plan) return null;
  if (session.deploymentMode === 'inhouse') return <LicenceBanner session={session} />;
  const until = plan.graceEndsAt ? formatDate(plan.graceEndsAt) : null;
  const message =
    plan.status === 'EXPIRED'
      ? 'Your organisation’s subscription has ended. You can view and export everything, but paid modules can’t be changed until it is renewed.'
      : plan.status === 'SUSPENDED'
        ? 'Your organisation’s subscription is suspended. You can view and export everything, but paid modules can’t be changed.'
        : plan.status === 'GRACE' || plan.status === 'PAST_DUE'
          ? `Your organisation’s subscription needs attention. Paid modules keep working${until ? ` until ${until}` : ''}, then become read-only.`
          : null;
  if (!message) return null;
  const severe = plan.access === 'READ_ONLY';
  return (
    <div
      role="status"
      className={cn(
        'border-b px-8 py-2.5 text-[13px]',
        severe
          ? 'border-danger/30 bg-danger-soft text-danger'
          : 'border-warning/30 bg-warning-soft text-warning',
      )}
    >
      {message}
      {can(session, 'settings.manage') && (
        <>
          {' '}
          <Link href="/admin/plan" className="font-semibold underline">
            See plan and usage
          </Link>
        </>
      )}
    </div>
  );
}

/** In-house installations: the same rules, worded for a licence rather than a subscription. */
function LicenceBanner({ session }: { session: SessionView }) {
  const plan = session.activeTenant?.plan;
  if (!plan) return null;
  const until = plan.graceEndsAt ? formatDate(plan.graceEndsAt) : null;
  const message =
    plan.status === 'NONE'
      ? session.user.isPlatformAdmin
        ? 'No licence is installed yet. Organisation administration works; install a licence to turn on paid modules.'
        : null
      : plan.status === 'EXPIRED'
        ? 'This installation’s licence has ended or can’t be verified. You can view and export everything, but paid modules can’t be changed until a new licence is installed.'
        : plan.status === 'GRACE'
          ? `This installation’s licence has ended. Paid modules keep working${until ? ` until ${until}` : ''}, then become read-only.`
          : null;
  if (!message) return null;
  return (
    <div
      role="status"
      className={cn(
        'border-b px-8 py-2.5 text-[13px]',
        plan.access === 'READ_ONLY'
          ? 'border-danger/30 bg-danger-soft text-danger'
          : 'border-warning/30 bg-warning-soft text-warning',
      )}
    >
      {message}
      {session.user.isPlatformAdmin && (
        <>
          {' '}
          <Link href="/platform/licence" className="font-semibold underline">
            Manage the licence
          </Link>
        </>
      )}
    </div>
  );
}
