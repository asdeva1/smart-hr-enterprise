'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import type { Vendor } from '@/lib/expenses';
import { financeKeys, useAccounts } from '@/lib/finance';
import { purchaseKeys } from '@/lib/purchases';
import { MODE_LABEL, type PaymentMode } from '@/lib/sales';

/** Record a payment to a vendor. It settles their oldest unpaid bills first. */
export function PaymentDialog({
  companyId,
  vendorId,
  amount,
  onClose,
}: {
  companyId: string;
  vendorId?: string | undefined;
  amount?: number | undefined;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const vendors = useQuery({
    queryKey: ['vendors', 'all'],
    queryFn: () => apiFetch<Vendor[]>('/v1/vendors?q='),
  });
  const accounts = useAccounts(companyId);
  const sources = (accounts.data ?? []).filter(
    (a) => a.type === 'ASSET' && a.status === 'ACTIVE' && (a.systemKey === 'BANK' || a.systemKey === 'CASH'),
  );
  const [f, setF] = useState({
    vendorId: vendorId ?? '',
    date: new Date().toISOString().slice(0, 10),
    amount: amount ? String(amount) : '',
    mode: 'BANK' as PaymentMode,
    reference: '',
    paidFromAccountId: '',
  });
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));
  const source = f.paidFromAccountId || sources[0]?.id || '';
  const save = useMutation({
    mutationFn: () =>
      apiFetch('/v1/finance/purchases/payments', {
        method: 'POST',
        body: {
          companyId,
          vendorId: f.vendorId,
          date: f.date,
          amount: Number(f.amount),
          mode: f.mode,
          reference: f.reference || null,
          paidFromAccountId: source,
        },
      }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: purchaseKeys.all }),
        client.invalidateQueries({ queryKey: financeKeys.all }),
      ]);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Record payment to a vendor"
      description="It settles this vendor’s oldest unpaid bills first and posts to your books."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || !f.vendorId || !(Number(f.amount) > 0) || !source}
            onClick={() => save.mutate()}
          >
            Record payment
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
          <Field id="p-vendor" label="Vendor">
            <Select
              id="p-vendor"
              value={f.vendorId}
              disabled={!!vendorId}
              onChange={(e) => set({ vendorId: e.target.value })}
            >
              <option value="">Choose a vendor</option>
              {(vendors.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field id="p-amount" label="Amount paid (₹)" hint="After TDS, the money that leaves your account">
          <Input
            id="p-amount"
            inputMode="decimal"
            value={f.amount}
            onChange={(e) => set({ amount: e.target.value })}
          />
        </Field>
        <Field id="p-date" label="Date paid">
          <Input id="p-date" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} />
        </Field>
        <Field id="p-mode" label="Paid by">
          <Select id="p-mode" value={f.mode} onChange={(e) => set({ mode: e.target.value as PaymentMode })}>
            {Object.entries(MODE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="p-from" label="Pay from">
          <Select id="p-from" value={source} onChange={(e) => set({ paidFromAccountId: e.target.value })}>
            {sources.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field id="p-ref" label="Payment reference (UTR or cheque number)">
            <Input id="p-ref" value={f.reference} onChange={(e) => set({ reference: e.target.value })} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
