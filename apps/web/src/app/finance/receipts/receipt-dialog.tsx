'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { financeKeys, useAccounts } from '@/lib/finance';
import { MODE_LABEL, salesKeys, useCustomers, type PaymentMode } from '@/lib/sales';

/** Record money received from a customer. It settles their oldest unpaid invoices first. */
export function ReceiptDialog({
  companyId,
  customerId,
  amount,
  onClose,
}: {
  companyId: string;
  customerId?: string | undefined;
  amount?: number | undefined;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const customers = useCustomers();
  const accounts = useAccounts(companyId);
  const deposits = (accounts.data ?? []).filter(
    (a) => a.type === 'ASSET' && a.status === 'ACTIVE' && (a.systemKey === 'BANK' || a.systemKey === 'CASH'),
  );
  const [f, setF] = useState({
    customerId: customerId ?? '',
    date: new Date().toISOString().slice(0, 10),
    amount: amount ? String(amount) : '',
    mode: 'BANK' as PaymentMode,
    reference: '',
    depositAccountId: '',
  });
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));
  const deposit = f.depositAccountId || deposits[0]?.id || '';
  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ number: string }>('/v1/finance/sales/receipts', {
        method: 'POST',
        body: {
          companyId,
          customerId: f.customerId,
          date: f.date,
          amount: Number(f.amount),
          mode: f.mode,
          reference: f.reference || null,
          depositAccountId: deposit,
        },
      }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: salesKeys.all }),
        client.invalidateQueries({ queryKey: financeKeys.all }),
      ]);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Record payment received"
      description="It settles this customer’s oldest unpaid invoices first and posts to your books."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || !f.customerId || !(Number(f.amount) > 0) || !deposit}
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
          <Field id="r-customer" label="Customer">
            <Select
              id="r-customer"
              value={f.customerId}
              disabled={!!customerId}
              onChange={(e) => set({ customerId: e.target.value })}
            >
              <option value="">Choose a customer</option>
              {(customers.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field id="r-amount" label="Amount received (₹)">
          <Input
            id="r-amount"
            inputMode="decimal"
            value={f.amount}
            onChange={(e) => set({ amount: e.target.value })}
          />
        </Field>
        <Field id="r-date" label="Date received">
          <Input id="r-date" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} />
        </Field>
        <Field id="r-mode" label="Paid by">
          <Select id="r-mode" value={f.mode} onChange={(e) => set({ mode: e.target.value as PaymentMode })}>
            {Object.entries(MODE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="r-deposit" label="Deposited into">
          <Select id="r-deposit" value={deposit} onChange={(e) => set({ depositAccountId: e.target.value })}>
            {deposits.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field id="r-ref" label="Reference (UTR or cheque number)">
            <Input id="r-ref" value={f.reference} onChange={(e) => set({ reference: e.target.value })} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
