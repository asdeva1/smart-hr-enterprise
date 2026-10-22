'use client';

import {
  BookOpen,
  Building,
  Building2,
  CalendarDays,
  ChevronDown,
  Landmark,
  UserRound,
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
  /** Shown when the member holds any one of these (instead of a single `permission`). */
  any?: string[];
  /** Another page title that highlights this item (for example the payslips item on the Payroll pages). */
  activeAs?: string;
  /** Hidden for members who hold this permission (they see the full module elsewhere). */
  unless?: string;
  /** Only for platform administrators. */
  platform?: boolean;
  /** Only for owners of the active organisation. */
  tenantAdmin?: boolean;
  /** Only in these deployment modes. */
  modes?: SessionView['deploymentMode'][];
}

/**
 * The sidebar. Groups open and close on click, and a group only appears when the member can use something in
 * it, so HR, finance and operations teams each see their own area. Organisation owners hold every
 * permission, so they see everything. The API enforces access regardless of what is shown here.
 */
interface NavGroup {
  id: string;
  title?: string;
  icon?: LucideIcon;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  { id: 'top', items: [{ label: 'Dashboard', icon: LayoutGrid, href: '/' }] },
  {
    id: 'my-work',
    title: 'My work',
    icon: UserRound,
    items: [
      { label: 'Attendance', icon: Clock, href: '/attendance', feature: 'attendance.basic' },
      { label: 'Leave', icon: CalendarDays, href: '/leave', feature: 'leave.basic' },
      { label: 'Approvals', icon: CircleCheck, href: '/approvals' },
      { label: 'Expenses', icon: Receipt, href: '/expenses', feature: 'expenses' },
      {
        label: 'My payslips',
        icon: Wallet,
        href: '/payroll/me',
        feature: 'payroll',
        unless: 'payroll.view',
        activeAs: 'Payroll',
      },
      { label: 'Documents', icon: FileText, href: '/documents', feature: 'documents' },
      {
        label: 'Onboarding',
        icon: ListTodo,
        href: '/onboarding',
        feature: 'onboarding',
        unless: 'onboarding.manage',
      },
      {
        label: 'Projects',
        icon: FolderKanban,
        href: '/projects',
        feature: 'projects',
        unless: 'projects.view',
      },
      { label: 'Assets', icon: Laptop, href: '/assets', feature: 'assets', unless: 'assets.view' },
      {
        label: 'Procurement',
        icon: ShoppingCart,
        href: '/procurement',
        feature: 'procurement',
        unless: 'procurement.view',
      },
    ],
  },
  {
    id: 'hr',
    title: 'HR',
    icon: Users,
    items: [
      {
        label: 'Employees',
        icon: Users,
        href: '/employees',
        permission: 'employees.view',
        feature: 'hr.core',
      },
      {
        label: 'Recruitment',
        icon: Briefcase,
        href: '/recruitment',
        any: ['recruitment.view', 'recruitment.manage'],
        feature: 'recruitment',
      },
      {
        label: 'Onboarding',
        icon: ListTodo,
        href: '/onboarding',
        permission: 'onboarding.manage',
        feature: 'onboarding',
      },
    ],
  },
  {
    id: 'finance',
    title: 'Accounts & Finance',
    icon: Landmark,
    items: [
      { label: 'Finance', icon: BookOpen, href: '/finance', permission: 'finance.view', feature: 'finance' },
      {
        label: 'Books of accounts',
        icon: BookOpen,
        href: '/finance/books-of-accounts',
        permission: 'finance.view',
        feature: 'finance',
      },
      { label: 'Payroll', icon: Wallet, href: '/payroll', permission: 'payroll.view', feature: 'payroll' },
      { label: 'Vendors', icon: Store, href: '/vendors', permission: 'vendors.view', feature: 'vendors' },
      {
        label: 'Procurement',
        icon: ShoppingCart,
        href: '/procurement',
        permission: 'procurement.view',
        feature: 'procurement',
      },
    ],
  },
  {
    id: 'operations',
    title: 'Operations',
    icon: Layers,
    items: [
      {
        label: 'Operations',
        icon: Layers,
        href: '/operations',
        any: ['operations.view', 'operations.contribute', 'operations.manage'],
        feature: 'operations.templates',
      },
      {
        label: 'Projects',
        icon: FolderKanban,
        href: '/projects',
        permission: 'projects.view',
        feature: 'projects',
      },
      { label: 'Assets', icon: Laptop, href: '/assets', permission: 'assets.view', feature: 'assets' },
      {
        label: 'Inventory',
        icon: Boxes,
        href: '/inventory',
        permission: 'inventory.view',
        feature: 'inventory',
      },
      { label: 'Organisation', icon: Building2, href: '/admin/organisation', permission: 'org.view' },
    ],
  },
  {
    id: 'admin',
    title: 'Administration',
    icon: Settings,
    items: [
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
    id: 'platform',
    title: 'Platform',
    icon: Building,
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
  if (item.any && !item.any.some((p) => can(session, p))) return false;
  if (item.unless && can(session, item.unless)) return false;
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
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => visible(item, session)),
  })).filter((group) => group.items.length > 0);
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
          {groups.map((group) => {
            const grouped = group.title !== undefined;
            const open =
              !grouped ||
              openGroups[group.id] === true ||
              group.items.some((i) => i.label === active || i.activeAs === active);
            const GroupIcon = group.icon;
            return (
              <div key={group.id} className="flex flex-col gap-0.5">
                {grouped && (
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`nav-${group.id}`}
                    onClick={() => setOpenGroups((all) => ({ ...all, [group.id]: !open }))}
                    className="mt-1 flex min-h-10 items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-semibold hover:bg-sidebar-accent/60 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
                  >
                    {GroupIcon && <GroupIcon aria-hidden="true" className="size-[18px]" strokeWidth={1.75} />}
                    {group.title}
                    <ChevronDown
                      aria-hidden="true"
                      className={cn('ml-auto size-4 transition-transform', open && 'rotate-180')}
                    />
                  </button>
                )}
                <div
                  id={`nav-${group.id}`}
                  hidden={!open}
                  className={cn(
                    'flex flex-col gap-0.5',
                    grouped && 'ml-3 border-l border-sidebar-accent/60 pl-1.5',
                  )}
                >
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = item.label === active || item.activeAs === active;
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
              </div>
            );
          })}
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
  const [now] = useState(() => Date.now());
  const plan = session.activeTenant?.plan;
  if (!plan) return null;
  if (session.deploymentMode === 'inhouse') return <LicenceBanner session={session} />;
  const until = plan.graceEndsAt ? formatDate(plan.graceEndsAt) : null;
  const trialDaysLeft =
    plan.status === 'TRIAL' && plan.trialEndsAt
      ? Math.max(0, Math.ceil((new Date(plan.trialEndsAt).getTime() - now) / 86_400_000))
      : null;
  const message =
    trialDaysLeft !== null
      ? `${plan.code === 'DEMO' ? 'Your demo' : 'Your free trial'} ends in ${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'}${plan.trialEndsAt ? ` (${formatDate(plan.trialEndsAt)})` : ''}. After that the workspace becomes read-only.`
      : plan.status === 'EXPIRED'
        ? 'Your organisation’s subscription has ended. You can view and export everything, but paid modules can’t be changed until it is renewed.'
        : plan.status === 'SUSPENDED'
          ? 'Your organisation’s subscription is suspended. You can view and export everything, but paid modules can’t be changed.'
          : plan.status === 'GRACE' || plan.status === 'PAST_DUE'
            ? `Your organisation’s subscription needs attention. Paid modules keep working${until ? ` until ${until}` : ''}, then become read-only.`
            : null;
  if (!message) return null;
  const severe = plan.access === 'READ_ONLY';
  const upgradeable = plan.status === 'TRIAL' || plan.status === 'EXPIRED' || plan.status === 'GRACE';
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
          <Link href={upgradeable ? '/admin/upgrade' : '/admin/plan'} className="font-semibold underline">
            {upgradeable ? 'Upgrade your plan' : 'See plan and usage'}
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
