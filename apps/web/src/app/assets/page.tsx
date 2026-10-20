'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { AssetDialog } from '@/components/assets/dialogs';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import { ASSET_STATUS_LABEL, ASSET_STATUS_TONE, assetKeys, type AssetRow, type MyAsset } from '@/lib/assets';
import { money } from '@/lib/expenses';
import { can, hasFeature } from '@/lib/permissions';

export default function AssetsPage() {
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="Assets" session={session}>
          {hasFeature(session, 'assets') ? (
            <Assets session={session} />
          ) : (
            <Alert tone="info">Your organisation’s plan doesn’t include assets.</Alert>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}

function Assets({ session }: { session: SessionView }) {
  const router = useRouter();
  const sees = can(session, 'assets.view');
  const [tab, setTab] = useState<'register' | 'mine'>(sees ? 'register' : 'mine');
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader
        title="Assets"
        description="What the company owns, who has it, and what it is worth after depreciation."
        actions={
          can(session, 'assets.manage') ? <Button onClick={() => setAdding(true)}>Add asset</Button> : null
        }
      />
      {sees && (
        <Tabs
          label="Assets"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'register', label: 'Register' },
            { value: 'mine', label: 'Assigned to me' },
          ]}
        />
      )}
      {tab === 'register' && sees ? <Register /> : <Mine />}
      {adding && (
        <AssetDialog onClose={() => setAdding(false)} onSaved={(a) => router.push(`/assets/${a.id}`)} />
      )}
    </>
  );
}

function Register() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const assets = useQuery({
    queryKey: assetKeys.list(q, status),
    queryFn: () =>
      apiFetch<AssetRow[]>(`/v1/assets?q=${encodeURIComponent(q)}${status ? `&status=${status}` : ''}`),
  });
  return (
    <>
      <div className="flex flex-wrap gap-4">
        <div className="max-w-xs">
          <Field id="asset-search" label="Search">
            <Input id="asset-search" value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
        </div>
        <div className="max-w-xs">
          <Field id="asset-status" label="Status">
            <Select id="asset-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {Object.entries(ASSET_STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
      {assets.isPending ? (
        <Loading />
      ) : assets.isError ? (
        <Alert tone="error">{errorMessage(assets.error)}</Alert>
      ) : assets.data.length === 0 ? (
        <EmptyState title="No assets yet">
          Add laptops, furniture and anything else you want to track.
        </EmptyState>
      ) : (
        <Table label="Assets">
          <thead>
            <tr>
              <Th>Tag</Th>
              <Th>Name</Th>
              <Th>Category</Th>
              <Th>With</Th>
              <Th className="text-right">Book value</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {assets.data.map((a) => (
              <tr key={a.id}>
                <Td className="whitespace-nowrap">
                  <Link href={`/assets/${a.id}`} className="font-medium text-primary hover:underline">
                    {a.tag}
                  </Link>
                </Td>
                <Td>{a.name}</Td>
                <Td>{a.category}</Td>
                <Td>{a.holder?.name ?? '—'}</Td>
                <Td className="text-right tabular-nums">{money(a.depreciation.bookValue, a.currency)}</Td>
                <Td>
                  <Badge tone={ASSET_STATUS_TONE[a.status]}>{ASSET_STATUS_LABEL[a.status]}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

function Mine() {
  const mine = useQuery({ queryKey: assetKeys.mine, queryFn: () => apiFetch<MyAsset[]>('/v1/assets/mine') });
  if (mine.isPending) return <Loading />;
  if (mine.isError) return <Alert tone="error">{errorMessage(mine.error)}</Alert>;
  if (mine.data.length === 0) {
    return <EmptyState title="Nothing assigned to you">Assets given to you appear here.</EmptyState>;
  }
  return (
    <Table label="Assets assigned to me">
      <thead>
        <tr>
          <Th>Tag</Th>
          <Th>Name</Th>
          <Th>Category</Th>
          <Th>Given on</Th>
          <Th>Condition</Th>
        </tr>
      </thead>
      <tbody>
        {mine.data.map((m) => (
          <tr key={m.assignmentId}>
            <Td>{m.asset.tag}</Td>
            <Td>{m.asset.name}</Td>
            <Td>{m.asset.category}</Td>
            <Td className="whitespace-nowrap">{m.assignedOn}</Td>
            <Td>{m.conditionOut ?? '—'}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
