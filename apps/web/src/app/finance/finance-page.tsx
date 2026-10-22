'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { useCompanies } from '@/lib/admin';
import type { SessionView } from '@/lib/api';
import { can, hasFeature } from '@/lib/permissions';
import { cn } from '@/lib/utils';

export function FinancePage({
  children,
  permission = 'finance.view',
  active = 'Finance',
}: {
  children: (session: SessionView) => ReactNode;
  permission?: string;
  active?: string;
}) {
  return (
    <RequireSession permission={permission}>
      {(session) => (
        <AppShell active={active} session={session}>
          {hasFeature(session, 'finance') ? (
            children(session)
          ) : (
            <Alert tone="info">Your organisation’s plan doesn’t include finance.</Alert>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}

export function FinanceTabs({ session, active }: { session: SessionView; active: string }) {
  const tabs = [
    { href: '/finance', label: 'Journals' },
    { href: '/finance/accounts', label: 'Chart of accounts' },
    { href: '/finance/books-of-accounts', label: 'Books of accounts' },
    { href: '/finance/reports', label: 'Reports' },
    ...(can(session, 'finance.configure') ? [{ href: '/finance/books', label: 'Close the books' }] : []),
  ];
  return (
    <nav aria-label="Finance" className="flex gap-1 overflow-x-auto border-b border-border">
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

export function CompanyPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const companies = useCompanies();
  if (!companies.data?.length) return null;
  return (
    <div className="max-w-xs">
      <Field id="books-company" label="Company">
        <Select id="books-company" value={value} onChange={(e) => onChange(e.target.value)}>
          {(companies.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
