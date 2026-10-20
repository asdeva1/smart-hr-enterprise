'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import { expenseKeys, type Vendor } from '@/lib/expenses';
import { can, hasFeature } from '@/lib/permissions';

export default function VendorsPage() {
  return (
    <RequireSession permission="vendors.view">
      {(session) => (
        <AppShell active="Vendors" session={session}>
          {hasFeature(session, 'vendors') ? (
            <Vendors session={session} />
          ) : (
            <Alert tone="info">Your organisation’s plan doesn’t include vendors.</Alert>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}

function Vendors({ session }: { session: SessionView }) {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Vendor | 'new' | null>(null);
  const vendors = useQuery({
    queryKey: [...expenseKeys.vendors, q],
    queryFn: () => apiFetch<Vendor[]>(`/v1/vendors?q=${encodeURIComponent(q)}`),
  });
  const manage = can(session, 'vendors.manage');
  return (
    <>
      <PageHeader
        title="Vendors"
        description="Who your organisation buys from. Shared by all companies."
        actions={manage ? <Button onClick={() => setEditing('new')}>Add vendor</Button> : null}
      />
      <div className="max-w-xs">
        <Field id="vendor-search" label="Search">
          <Input id="vendor-search" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
      </div>
      {vendors.isPending ? (
        <Loading />
      ) : vendors.isError ? (
        <Alert tone="error">{errorMessage(vendors.error)}</Alert>
      ) : vendors.data.length === 0 ? (
        <EmptyState title="No vendors yet">Add the suppliers you pay.</EmptyState>
      ) : (
        <Table label="Vendors">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>GSTIN</Th>
              <Th>Contact</Th>
              <Th className="text-right">Payment terms</Th>
              <Th>Status</Th>
              {manage && (
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              )}
            </tr>
          </thead>
          <tbody>
            {vendors.data.map((v) => (
              <tr key={v.id}>
                <Td>{v.code}</Td>
                <Td className="font-medium">{v.name}</Td>
                <Td>{v.gstin ?? '—'}</Td>
                <Td>{[v.contactName, v.phone].filter(Boolean).join(' · ') || '—'}</Td>
                <Td className="text-right tabular-nums">{v.paymentTermsDays} days</Td>
                <Td>
                  <Badge tone={v.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {v.status === 'ACTIVE' ? 'Active' : 'Archived'}
                  </Badge>
                </Td>
                {manage && (
                  <Td>
                    <Button variant="outline" onClick={() => setEditing(v)}>
                      Edit
                    </Button>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && (
        <VendorDialog vendor={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function VendorDialog({ vendor, onClose }: { vendor?: Vendor | undefined; onClose: () => void }) {
  const client = useQueryClient();
  const [f, setF] = useState({
    code: vendor?.code ?? '',
    name: vendor?.name ?? '',
    gstin: vendor?.gstin ?? '',
    pan: vendor?.pan ?? '',
    contactName: vendor?.contactName ?? '',
    email: vendor?.email ?? '',
    phone: vendor?.phone ?? '',
    address: vendor?.address ?? '',
    paymentTermsDays: String(vendor?.paymentTermsDays ?? 30),
    archived: vendor?.status === 'ARCHIVED',
  });
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));
  const save = useMutation({
    mutationFn: () => {
      const { code, archived, paymentTermsDays, ...rest } = f;
      const body = { ...rest, paymentTermsDays: Number(paymentTermsDays) };
      return vendor
        ? apiFetch(`/v1/vendors/${vendor.id}`, {
            method: 'PATCH',
            body: { ...body, status: archived ? 'ARCHIVED' : 'ACTIVE' },
          })
        : apiFetch('/v1/vendors', { method: 'POST', body: { ...body, code } });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: expenseKeys.vendors });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={vendor ? 'Edit vendor' : 'Add vendor'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !f.name || (!vendor && !f.code)} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {save.isError && (
          <div className="sm:col-span-2">
            <Alert tone="error">{errorMessage(save.error)}</Alert>
          </div>
        )}
        {!vendor && (
          <Field id="v-code" label="Code">
            <Input id="v-code" value={f.code} onChange={(e) => set({ code: e.target.value })} />
          </Field>
        )}
        <Field id="v-name" label="Name">
          <Input id="v-name" value={f.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field id="v-gstin" label="GSTIN">
          <Input id="v-gstin" value={f.gstin} onChange={(e) => set({ gstin: e.target.value })} />
        </Field>
        <Field id="v-pan" label="PAN">
          <Input id="v-pan" value={f.pan} onChange={(e) => set({ pan: e.target.value })} />
        </Field>
        <Field id="v-contact" label="Contact person">
          <Input
            id="v-contact"
            value={f.contactName}
            onChange={(e) => set({ contactName: e.target.value })}
          />
        </Field>
        <Field id="v-email" label="Email">
          <Input id="v-email" type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} />
        </Field>
        <Field id="v-phone" label="Phone">
          <Input id="v-phone" value={f.phone} onChange={(e) => set({ phone: e.target.value })} />
        </Field>
        <Field id="v-terms" label="Payment terms (days)">
          <Input
            id="v-terms"
            inputMode="numeric"
            value={f.paymentTermsDays}
            onChange={(e) => set({ paymentTermsDays: e.target.value })}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field id="v-address" label="Address">
            <Input id="v-address" value={f.address} onChange={(e) => set({ address: e.target.value })} />
          </Field>
        </div>
        {vendor && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={f.archived}
              onChange={(e) => set({ archived: e.target.checked })}
            />
            Archived (can’t be chosen for new purchases)
          </label>
        )}
      </div>
    </Dialog>
  );
}
