'use client';

import { computeSalesTotals, stateOfGstin } from '@smart-hr/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import type { Vendor } from '@/lib/expenses';
import { financeKeys, inr, useAccounts } from '@/lib/finance';
import { TDS_RATES, purchaseKeys, type Bill, type BillType } from '@/lib/purchases';
import { GST_RATES } from '@/lib/sales';

interface Line {
  description: string;
  hsn: string;
  quantity: string;
  rate: string;
  gstRate: string;
  accountId: string;
}
const blank: Line = { description: '', hsn: '', quantity: '1', rate: '', gstRate: '18', accountId: '' };
const today = () => new Date().toISOString().slice(0, 10);

/** Enter or edit a draft vendor bill. Nothing reaches the books until it is posted. */
export function BillEditor({
  companyId,
  type,
  existing,
}: {
  companyId: string;
  type: BillType;
  existing?: Bill | undefined;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const vendors = useQuery({
    queryKey: ['vendors', 'all'],
    queryFn: () => apiFetch<Vendor[]>('/v1/vendors?q='),
  });
  const accounts = useAccounts(companyId);
  const seller = useQuery({
    queryKey: ['sales', 'settings', companyId],
    queryFn: () => apiFetch<{ stateCode: string | null }>(`/v1/finance/sales/settings/${companyId}`),
  });
  const postable = (accounts.data ?? []).filter(
    (a) => a.status === 'ACTIVE' && (a.type === 'EXPENSE' || a.type === 'ASSET') && !a.systemKey,
  );
  const [f, setF] = useState(() => ({
    vendorId: existing?.vendor.id ?? '',
    vendorBillNo: existing?.vendorBillNo ?? '',
    date: existing?.date ?? today(),
    dueDate: existing?.dueDate ?? '',
    tdsRate: String(existing?.tdsRate ?? 0),
    note: existing?.note ?? '',
    lines: existing
      ? existing.lines.map((l) => ({
          description: l.description,
          hsn: l.hsn ?? '',
          quantity: String(l.quantity),
          rate: String(l.rate),
          gstRate: String(l.gstRate),
          accountId: l.accountId,
        }))
      : [{ ...blank }],
  }));
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));
  const setLine = (i: number, patch: Partial<Line>) =>
    setF((s) => ({ ...s, lines: s.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  const vendor = (vendors.data ?? []).find((v) => v.id === f.vendorId);
  const vendorState = stateOfGstin(vendor?.gstin);
  const sellerState = seller.data?.stateCode ?? null;
  const intra = !vendorState || !sellerState || vendorState === sellerState;
  const totals = computeSalesTotals(
    f.lines.map((l) => ({
      quantity: Number(l.quantity) || 0,
      rate: Number(l.rate) || 0,
      discountPct: 0,
      gstRate: Number(l.gstRate) || 0,
    })),
    intra,
  );
  const tds = Math.round(totals.subtotal * (Number(f.tdsRate) || 0)) / 100;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        vendorId: f.vendorId,
        vendorBillNo: f.vendorBillNo || null,
        date: f.date,
        dueDate: f.dueDate || null,
        placeOfSupply: vendorState,
        note: f.note || null,
        tdsRate: Number(f.tdsRate),
        lines: f.lines.map((l) => ({
          description: l.description,
          hsn: l.hsn || null,
          quantity: Number(l.quantity),
          rate: Number(l.rate),
          gstRate: Number(l.gstRate),
          accountId: l.accountId,
        })),
      };
      return existing
        ? apiFetch<Bill>(`/v1/finance/purchases/bills/${existing.id}`, { method: 'PUT', body })
        : apiFetch<Bill>('/v1/finance/purchases/bills', {
            method: 'POST',
            body: { ...body, companyId, type },
          });
    },
    onSuccess: async (b) => {
      await client.invalidateQueries({ queryKey: purchaseKeys.all });
      await client.invalidateQueries({ queryKey: financeKeys.all });
      router.push(`/finance/bills/${b.id}`);
    },
  });
  const ready =
    !!f.vendorId &&
    f.lines.every((l) => l.description && Number(l.quantity) > 0 && l.rate !== '' && l.accountId);
  const label = type === 'BILL' ? 'bill' : 'debit note';

  return (
    <>
      <PageHeader
        title={existing ? `Edit draft ${label}` : `New ${label}`}
        description="Save it as a draft first. Posting it adds the expense, input GST and what you owe to your books."
      />
      {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="b-vendor" label="Vendor">
          <Select id="b-vendor" value={f.vendorId} onChange={(e) => set({ vendorId: e.target.value })}>
            <option value="">Choose a vendor</option>
            {(vendors.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="b-no" label="Vendor’s bill number">
          <Input id="b-no" value={f.vendorBillNo} onChange={(e) => set({ vendorBillNo: e.target.value })} />
        </Field>
        <Field id="b-date" label="Bill date">
          <Input id="b-date" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} />
        </Field>
        <Field id="b-due" label="Due date" hint="Blank uses the vendor’s payment terms">
          <Input
            id="b-due"
            type="date"
            value={f.dueDate}
            onChange={(e) => set({ dueDate: e.target.value })}
          />
        </Field>
      </div>

      <div className="space-y-3">
        {f.lines.map((l, i) => (
          <div key={i} className="grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-6">
            <div className="sm:col-span-3">
              <Field id={`l-d-${i}`} label="Item or service">
                <Input
                  id={`l-d-${i}`}
                  value={l.description}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                />
              </Field>
            </div>
            <div className="sm:col-span-3">
              <Field id={`l-a-${i}`} label="Book it to">
                <Select
                  id={`l-a-${i}`}
                  value={l.accountId}
                  onChange={(e) => setLine(i, { accountId: e.target.value })}
                >
                  <option value="">Choose an account</option>
                  {postable.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field id={`l-h-${i}`} label="HSN or SAC">
              <Input
                id={`l-h-${i}`}
                inputMode="numeric"
                value={l.hsn}
                onChange={(e) => setLine(i, { hsn: e.target.value })}
              />
            </Field>
            <Field id={`l-q-${i}`} label="Quantity">
              <Input
                id={`l-q-${i}`}
                inputMode="decimal"
                value={l.quantity}
                onChange={(e) => setLine(i, { quantity: e.target.value })}
              />
            </Field>
            <Field id={`l-r-${i}`} label="Rate (₹)">
              <Input
                id={`l-r-${i}`}
                inputMode="decimal"
                value={l.rate}
                onChange={(e) => setLine(i, { rate: e.target.value })}
              />
            </Field>
            <Field id={`l-g-${i}`} label="GST">
              <Select
                id={`l-g-${i}`}
                value={l.gstRate}
                onChange={(e) => setLine(i, { gstRate: e.target.value })}
              >
                {GST_RATES.map((r) => (
                  <option key={r} value={r}>
                    {r}%
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end justify-between gap-2 sm:col-span-2">
              <span className="pb-2 font-medium tabular-nums">₹{inr(totals.lines[i]?.amount ?? 0)}</span>
              {f.lines.length > 1 && (
                <Button variant="outline" onClick={() => set({ lines: f.lines.filter((_, j) => j !== i) })}>
                  Remove
                </Button>
              )}
            </div>
          </div>
        ))}
        <Button variant="outline" onClick={() => set({ lines: [...f.lines, { ...blank }] })}>
          Add another item
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Field id="b-tds" label="TDS to deduct" hint="Held back from the vendor and owed to the government">
            <Select id="b-tds" value={f.tdsRate} onChange={(e) => set({ tdsRate: e.target.value })}>
              {TDS_RATES.map((r) => (
                <option key={r} value={r}>
                  {r === 0 ? 'No TDS' : `${r}%`}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="b-note" label="Note">
            <Input id="b-note" value={f.note} onChange={(e) => set({ note: e.target.value })} />
          </Field>
        </div>
        <dl className="space-y-1.5 rounded-lg border border-border bg-card p-4 tabular-nums">
          <Row k="Subtotal" v={totals.subtotal} />
          {intra ? (
            <>
              <Row k="CGST (input)" v={totals.cgst} />
              <Row k="SGST (input)" v={totals.sgst} />
            </>
          ) : (
            <Row k="IGST (input)" v={totals.igst} />
          )}
          <Row k="Bill total" v={totals.total} bold />
          {tds > 0 && <Row k={`Less TDS ${f.tdsRate}%`} v={-tds} />}
          <Row k="You will pay the vendor" v={totals.total - tds} bold />
        </dl>
      </div>
      <div className="flex gap-3">
        <Button disabled={!ready || save.isPending} onClick={() => save.mutate()}>
          Save draft
        </Button>
        <Button variant="outline" onClick={() => router.push('/finance/bills')}>
          Cancel
        </Button>
      </div>
    </>
  );
}

function Row({ k, v, bold }: { k: string; v: number; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
      <dt>{k}</dt>
      <dd>₹{inr(v)}</dd>
    </div>
  );
}
