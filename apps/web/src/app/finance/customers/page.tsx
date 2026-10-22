'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { can } from '@/lib/permissions';
import { GST_STATES, salesKeys, useCustomers, type Customer } from '@/lib/sales';
import { FinancePage, SalesTabs } from '../finance-page';

export default function CustomersPage() {
  return (
    <FinancePage active="Customers">
      {(session) => <Customers canManage={can(session, 'finance.manage')} />}
    </FinancePage>
  );
}

function Customers({ canManage }: { canManage: boolean }) {
  const customers = useCustomers();
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Customers"
        description="Who you bill. Shared by all companies in your organisation."
        actions={canManage ? <Button onClick={() => setEditing('new')}>Add customer</Button> : null}
      />
      <SalesTabs active="/finance/customers" />
      {customers.isPending ? (
        <Loading />
      ) : customers.isError ? (
        <Alert tone="error">{errorMessage(customers.error)}</Alert>
      ) : customers.data.length === 0 ? (
        <EmptyState title="No customers yet">Add the people and businesses you invoice.</EmptyState>
      ) : (
        <Table label="Customers">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>GSTIN</Th>
              <Th>State</Th>
              <Th>Contact</Th>
              <Th className="text-right">Terms</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {customers.data.map((c) => (
              <tr key={c.id}>
                <Td>{c.code}</Td>
                <Td className="font-medium">
                  <Link href={`/finance/customers/${c.id}`} className="text-primary hover:underline">
                    {c.name}
                  </Link>
                </Td>
                <Td>{c.gstin ?? '—'}</Td>
                <Td>{c.stateCode ? (GST_STATES[c.stateCode] ?? c.stateCode) : '—'}</Td>
                <Td>{[c.contactName, c.phone].filter(Boolean).join(' · ') || '—'}</Td>
                <Td className="text-right tabular-nums">{c.paymentTermsDays} days</Td>
                <Td>
                  <Badge tone={c.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {c.status === 'ACTIVE' ? 'Active' : 'Archived'}
                  </Badge>
                </Td>
                <Td>
                  {canManage && (
                    <Button variant="outline" size="sm" onClick={() => setEditing(c)}>
                      Edit
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && (
        <CustomerDialog customer={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function CustomerDialog({ customer, onClose }: { customer?: Customer | undefined; onClose: () => void }) {
  const client = useQueryClient();
  const [f, setF] = useState({
    name: customer?.name ?? '',
    gstin: customer?.gstin ?? '',
    pan: customer?.pan ?? '',
    stateCode: customer?.stateCode ?? '',
    contactName: customer?.contactName ?? '',
    email: customer?.email ?? '',
    phone: customer?.phone ?? '',
    billingAddress: customer?.billingAddress ?? '',
    paymentTermsDays: String(customer?.paymentTermsDays ?? 15),
    archived: customer?.status === 'ARCHIVED',
  });
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));
  const save = useMutation({
    mutationFn: () => {
      const { archived, paymentTermsDays, ...rest } = f;
      const body = { ...rest, paymentTermsDays: Number(paymentTermsDays) };
      return customer
        ? apiFetch(`/v1/finance/sales/customers/${customer.id}`, {
            method: 'PUT',
            body: { ...body, status: archived ? 'ARCHIVED' : 'ACTIVE' },
          })
        : apiFetch('/v1/finance/sales/customers', { method: 'POST', body });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: salesKeys.customers });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={customer ? 'Edit customer' : 'Add customer'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !f.name} onClick={() => save.mutate()}>
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
        <div className="sm:col-span-2">
          <Field id="c-name" label="Name">
            <Input id="c-name" value={f.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
        </div>
        <Field id="c-gstin" label="GSTIN" hint="Sets the state for GST">
          <Input id="c-gstin" value={f.gstin} onChange={(e) => set({ gstin: e.target.value })} />
        </Field>
        <Field id="c-pan" label="PAN">
          <Input id="c-pan" value={f.pan} onChange={(e) => set({ pan: e.target.value })} />
        </Field>
        <Field id="c-state" label="State">
          <Select id="c-state" value={f.stateCode} onChange={(e) => set({ stateCode: e.target.value })}>
            <option value="">From the GSTIN</option>
            {Object.entries(GST_STATES).map(([code, name]) => (
              <option key={code} value={code}>
                {name} ({code})
              </option>
            ))}
          </Select>
        </Field>
        <Field id="c-terms" label="Payment terms (days)">
          <Input
            id="c-terms"
            inputMode="numeric"
            value={f.paymentTermsDays}
            onChange={(e) => set({ paymentTermsDays: e.target.value })}
          />
        </Field>
        <Field id="c-contact" label="Contact person">
          <Input
            id="c-contact"
            value={f.contactName}
            onChange={(e) => set({ contactName: e.target.value })}
          />
        </Field>
        <Field id="c-phone" label="Phone">
          <Input id="c-phone" value={f.phone} onChange={(e) => set({ phone: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <Field id="c-email" label="Email">
            <Input
              id="c-email"
              type="email"
              value={f.email}
              onChange={(e) => set({ email: e.target.value })}
            />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field id="c-address" label="Billing address">
            <textarea
              id="c-address"
              rows={2}
              className="w-full rounded-md border border-input bg-card px-3 py-2"
              value={f.billingAddress}
              onChange={(e) => set({ billingAddress: e.target.value })}
            />
          </Field>
        </div>
        {customer && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={f.archived}
              onChange={(e) => set({ archived: e.target.checked })}
            />
            Archived (can’t be chosen for new invoices)
          </label>
        )}
      </div>
    </Dialog>
  );
}
