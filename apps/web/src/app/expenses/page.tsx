'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { ClaimDialog } from '@/components/expenses/claim-form';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import {
  CLAIM_STATUS_LABEL,
  CLAIM_STATUS_TONE,
  expenseKeys,
  money,
  useExpenseCategories,
  type ClaimRow,
  type ExpenseCategory,
} from '@/lib/expenses';
import { can, hasFeature } from '@/lib/permissions';

type Tab = 'mine' | 'all' | 'categories';

export default function ExpensesPage() {
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="Expenses" session={session}>
          {hasFeature(session, 'expenses') ? (
            <Expenses session={session} />
          ) : (
            <Alert tone="info">Your organisation’s plan doesn’t include expenses.</Alert>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}

function Expenses({ session }: { session: SessionView }) {
  const [tab, setTab] = useState<Tab>('mine');
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const tabs: { value: Tab; label: string }[] = [
    { value: 'mine', label: 'My claims' },
    ...(can(session, 'expenses.view') ? [{ value: 'all' as const, label: 'All claims' }] : []),
    ...(can(session, 'expenses.manage') ? [{ value: 'categories' as const, label: 'Categories' }] : []),
  ];
  return (
    <>
      <PageHeader
        title="Expenses"
        description="Claim back what you spent for work. Your manager approves, then finance pays you."
        actions={<Button onClick={() => setCreating(true)}>New claim</Button>}
      />
      <Tabs label="Expenses" value={tab} onChange={setTab} options={tabs} />
      {tab === 'categories' ? <Categories /> : <Claims scope={tab} />}
      {creating && (
        <ClaimDialog onClose={() => setCreating(false)} onSaved={(c) => router.push(`/expenses/${c.id}`)} />
      )}
    </>
  );
}

function Claims({ scope }: { scope: 'mine' | 'all' }) {
  const claims = useQuery({
    queryKey: expenseKeys.claims(scope),
    queryFn: () => apiFetch<ClaimRow[]>(`/v1/expenses/claims?scope=${scope}`),
  });
  if (claims.isPending) return <Loading />;
  if (claims.isError) return <Alert tone="error">{errorMessage(claims.error)}</Alert>;
  if (claims.data.length === 0) {
    return (
      <EmptyState title="No claims yet">
        {scope === 'mine' ? 'Start a claim for anything you paid for work.' : 'Nothing to show here yet.'}
      </EmptyState>
    );
  }
  return (
    <Table label="Expense claims">
      <thead>
        <tr>
          <Th>Number</Th>
          <Th>Claim</Th>
          {scope === 'all' && <Th>Employee</Th>}
          <Th className="text-right">Amount</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {claims.data.map((c) => (
          <tr key={c.id}>
            <Td className="whitespace-nowrap">{c.number ?? 'Draft'}</Td>
            <Td>
              <Link href={`/expenses/${c.id}`} className="font-medium text-primary hover:underline">
                {c.title}
              </Link>
            </Td>
            {scope === 'all' && <Td>{c.employee.name}</Td>}
            <Td className="text-right tabular-nums">{money(c.total, c.currency)}</Td>
            <Td>
              <Badge tone={CLAIM_STATUS_TONE[c.status]}>{CLAIM_STATUS_LABEL[c.status]}</Badge>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Categories() {
  const categories = useExpenseCategories();
  const [editing, setEditing] = useState<ExpenseCategory | 'new' | null>(null);
  if (categories.isPending) return <Loading />;
  if (categories.isError) return <Alert tone="error">{errorMessage(categories.error)}</Alert>;
  return (
    <>
      <div>
        <Button variant="outline" onClick={() => setEditing('new')}>
          Add category
        </Button>
      </div>
      <Table label="Expense categories">
        <thead>
          <tr>
            <Th>Code</Th>
            <Th>Name</Th>
            <Th>Receipt</Th>
            <Th className="text-right">Limit per expense</Th>
            <Th>Status</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {categories.data.map((c) => (
            <tr key={c.id}>
              <Td>{c.code}</Td>
              <Td>{c.name}</Td>
              <Td>{c.requiresReceipt ? 'Required' : 'Optional'}</Td>
              <Td className="text-right tabular-nums">{c.maxAmount === null ? 'No limit' : c.maxAmount}</Td>
              <Td>
                <Badge tone={c.status === 'ACTIVE' ? 'success' : 'neutral'}>
                  {c.status === 'ACTIVE' ? 'Active' : 'Archived'}
                </Badge>
              </Td>
              <Td>
                <Button variant="outline" onClick={() => setEditing(c)}>
                  Edit
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {editing && (
        <CategoryDialog category={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function CategoryDialog({
  category,
  onClose,
}: {
  category?: ExpenseCategory | undefined;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [code, setCode] = useState(category?.code ?? '');
  const [name, setName] = useState(category?.name ?? '');
  const [receipt, setReceipt] = useState(category?.requiresReceipt ?? false);
  const [max, setMax] = useState(category?.maxAmount === null || !category ? '' : String(category.maxAmount));
  const [archived, setArchived] = useState(category?.status === 'ARCHIVED');
  const save = useMutation({
    mutationFn: () => {
      const shared = { name, requiresReceipt: receipt, maxAmount: max === '' ? null : Number(max) };
      return category
        ? apiFetch(`/v1/expenses/categories/${category.id}`, {
            method: 'PATCH',
            body: { ...shared, status: archived ? 'ARCHIVED' : 'ACTIVE' },
          })
        : apiFetch('/v1/expenses/categories', { method: 'POST', body: { ...shared, code } });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: expenseKeys.categories });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={category ? 'Edit category' : 'Add category'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !name || (!category && !code)} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        {!category && (
          <Field id="cat-code" label="Code" hint="Short and capital letters, e.g. TRAVEL">
            <Input id="cat-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
        )}
        <Field id="cat-name" label="Name">
          <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="cat-max" label="Limit per expense" hint="Leave empty for no limit">
          <Input id="cat-max" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={receipt} onChange={(e) => setReceipt(e.target.checked)} />
          Every expense needs a receipt or bill number
        </label>
        {category && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            Archived (can’t be chosen on new claims)
          </label>
        )}
      </div>
    </Dialog>
  );
}
