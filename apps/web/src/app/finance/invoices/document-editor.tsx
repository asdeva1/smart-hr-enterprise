'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { amountInWords, computeSalesTotals } from '@smart-hr/validation';
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
import { useCompanies } from '@/lib/admin';
import {
  DOC_TYPE_LABEL,
  GST_RATES,
  GST_STATES,
  salesKeys,
  useCustomers,
  useTemplates,
  type SalesDocType,
  type SalesDocument,
  type SalesLine,
  type Seller,
} from '@/lib/sales';
import { DocumentPreview } from './document-preview';

interface Draft {
  customerId: string;
  templateId: string;
  date: string;
  dueDate: string;
  poNumber: string;
  placeOfSupply: string;
  note: string;
  terms: string;
  lines: {
    description: string;
    hsn: string;
    quantity: string;
    unit: string;
    rate: string;
    discountPct: string;
    gstRate: string;
  }[];
}

const blankLine = {
  description: '',
  hsn: '',
  quantity: '1',
  unit: '',
  rate: '',
  discountPct: '0',
  gstRate: '18',
};
const today = () => new Date().toISOString().slice(0, 10);

function fromDoc(d: SalesDocument): Draft {
  return {
    customerId: d.customer.id,
    templateId: d.template?.id ?? '',
    date: d.date,
    dueDate: d.dueDate ?? '',
    poNumber: d.poNumber ?? '',
    placeOfSupply: d.placeOfSupply ?? '',
    note: d.note ?? '',
    terms: d.terms ?? '',
    lines: d.lines.map((l) => ({
      description: l.description,
      hsn: l.hsn ?? '',
      quantity: String(l.quantity),
      unit: l.unit ?? '',
      rate: String(l.rate),
      discountPct: String(l.discountPct),
      gstRate: String(l.gstRate),
    })),
  };
}

/** Create or edit a draft sales document, with the customer's view of it beside the form. */
export function DocumentEditor({
  companyId,
  type,
  existing,
  fromId,
}: {
  companyId: string;
  type: SalesDocType;
  existing?: SalesDocument | undefined;
  fromId?: string | undefined;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const customers = useCustomers();
  const templates = useTemplates();
  const companies = useCompanies();
  const settings = useQuery({
    queryKey: salesKeys.settings(companyId),
    queryFn: () =>
      apiFetch<Seller & { company: { name: string } }>(`/v1/finance/sales/settings/${companyId}`),
  });
  const [d, setD] = useState<Draft>(() =>
    existing
      ? fromDoc(existing)
      : {
          customerId: '',
          templateId: '',
          date: today(),
          dueDate: '',
          poNumber: '',
          placeOfSupply: '',
          note: '',
          terms: '',
          lines: [{ ...blankLine }],
        },
  );
  const set = (patch: Partial<Draft>) => setD((s) => ({ ...s, ...patch }));
  const setLine = (i: number, patch: Partial<Draft['lines'][number]>) =>
    setD((s) => ({ ...s, lines: s.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  const activeCustomers = (customers.data ?? []).filter(
    (c) => c.status === 'ACTIVE' || c.id === d.customerId,
  );
  const customer = activeCustomers.find((c) => c.id === d.customerId) ?? null;
  const template =
    (templates.data ?? []).find((t) => t.id === d.templateId) ??
    (templates.data ?? []).find((t) => t.isDefault) ??
    null;
  const sellerState = settings.data?.stateCode ?? null;
  const pos = d.placeOfSupply || customer?.stateCode || '';
  const intra = !sellerState || !pos || sellerState === pos;

  const parsed = d.lines.map((l) => ({
    description: l.description,
    hsn: l.hsn || null,
    quantity: Number(l.quantity) || 0,
    unit: l.unit || null,
    rate: Number(l.rate) || 0,
    discountPct: Number(l.discountPct) || 0,
    gstRate: Number(l.gstRate) || 0,
  }));
  const totals = computeSalesTotals(
    parsed.map((l) => ({
      quantity: l.quantity,
      rate: l.rate,
      discountPct: l.discountPct,
      gstRate: l.gstRate,
    })),
    intra,
  );

  const body = () => ({
    customerId: d.customerId,
    templateId: d.templateId || null,
    date: d.date,
    dueDate: d.dueDate || null,
    poNumber: d.poNumber || null,
    placeOfSupply: d.placeOfSupply || null,
    note: d.note || null,
    terms: d.terms || null,
    ...(existing ? {} : fromId ? { relatedId: fromId } : {}),
    lines: parsed,
  });
  const save = useMutation({
    mutationFn: async (issue: boolean) => {
      const saved = existing
        ? await apiFetch<SalesDocument>(`/v1/finance/sales/documents/${existing.id}`, {
            method: 'PUT',
            body: body(),
          })
        : await apiFetch<SalesDocument>('/v1/finance/sales/documents', {
            method: 'POST',
            body: { companyId, type, ...body() },
          });
      if (issue) await apiFetch(`/v1/finance/sales/documents/${saved.id}/issue`, { method: 'POST' });
      return saved;
    },
    onSuccess: async (saved) => {
      await client.invalidateQueries({ queryKey: salesKeys.all });
      router.push(`/finance/invoices/${saved.id}`);
    },
  });

  const previewLines: (SalesLine & { amount: number })[] = parsed.map((l, i) => ({
    ...l,
    amount: totals.lines[i]?.amount ?? 0,
  }));
  const label = DOC_TYPE_LABEL[type];
  const canSave = !!d.customerId && parsed.every((l) => l.description.trim() && l.quantity > 0);
  return (
    <>
      <PageHeader
        title={existing ? `Edit ${label.toLowerCase()}` : `New ${label.toLowerCase()}`}
        description={
          type === 'INVOICE' || type === 'CREDIT_NOTE'
            ? 'It posts to your books when you issue it.'
            : 'This does not affect your books.'
        }
        actions={
          <>
            <Button
              variant="outline"
              disabled={!canSave || save.isPending}
              onClick={() => save.mutate(false)}
            >
              Save draft
            </Button>
            <Button disabled={!canSave || save.isPending} onClick={() => save.mutate(true)}>
              Save and issue
            </Button>
          </>
        }
      />
      {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
      {!sellerState && (type === 'INVOICE' || type === 'CREDIT_NOTE') && (
        <Alert tone="info">
          Add your GSTIN or state under Business details before issuing a tax invoice, so GST is split
          correctly.
        </Alert>
      )}
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[1_1_560px] flex-col gap-4">
          <section
            aria-labelledby="doc-details"
            className="grid gap-4 rounded-lg border border-border bg-card p-5 sm:grid-cols-2"
          >
            <h2 id="doc-details" className="text-base font-semibold sm:col-span-2">
              Details
            </h2>
            <Field id="d-customer" label="Customer">
              <Select
                id="d-customer"
                value={d.customerId}
                onChange={(e) => set({ customerId: e.target.value, placeOfSupply: '' })}
              >
                <option value="">Choose a customer</option>
                {activeCustomers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="d-template" label="Template">
              <Select
                id="d-template"
                value={d.templateId}
                onChange={(e) => set({ templateId: e.target.value })}
              >
                <option value="">Default{template ? ` (${template.name})` : ''}</option>
                {(templates.data ?? [])
                  .filter((t) => t.status === 'ACTIVE')
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field id="d-date" label="Date">
              <Input id="d-date" type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} />
            </Field>
            {type === 'INVOICE' && (
              <Field
                id="d-due"
                label="Due date"
                hint={`Leave empty to use ${customer?.paymentTermsDays ?? 15} days from the date`}
              >
                <Input
                  id="d-due"
                  type="date"
                  value={d.dueDate}
                  onChange={(e) => set({ dueDate: e.target.value })}
                />
              </Field>
            )}
            <Field id="d-po" label="Customer PO number (optional)">
              <Input id="d-po" value={d.poNumber} onChange={(e) => set({ poNumber: e.target.value })} />
            </Field>
            <Field
              id="d-pos"
              label="Place of supply"
              hint={intra ? 'Within your state: CGST and SGST' : 'Another state: IGST'}
            >
              <Select
                id="d-pos"
                value={d.placeOfSupply}
                onChange={(e) => set({ placeOfSupply: e.target.value })}
              >
                <option value="">
                  {customer?.stateCode
                    ? `${GST_STATES[customer.stateCode] ?? customer.stateCode} (customer’s state)`
                    : 'Same as the customer'}
                </option>
                {Object.entries(GST_STATES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name} ({code})
                  </option>
                ))}
              </Select>
            </Field>
          </section>

          <section
            aria-labelledby="doc-items"
            className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5"
          >
            <h2 id="doc-items" className="text-base font-semibold">
              Items
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="text-xs font-semibold text-muted-foreground">
                    <th className="pr-2 pb-2">Description</th>
                    <th className="px-2 pb-2">HSN/SAC</th>
                    <th className="px-2 pb-2 text-right">Qty</th>
                    <th className="px-2 pb-2 text-right">Rate</th>
                    <th className="px-2 pb-2 text-right">Disc %</th>
                    <th className="px-2 pb-2">GST</th>
                    <th className="pb-2 pl-2 text-right">Amount</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {d.lines.map((l, i) => (
                    <tr key={i} className="border-t border-border align-top">
                      <td className="py-2 pr-2">
                        <Input
                          aria-label={`Item ${i + 1} description`}
                          value={l.description}
                          onChange={(e) => setLine(i, { description: e.target.value })}
                        />
                      </td>
                      <td className="w-24 px-2 py-2">
                        <Input
                          aria-label={`Item ${i + 1} HSN or SAC`}
                          inputMode="numeric"
                          value={l.hsn}
                          onChange={(e) => setLine(i, { hsn: e.target.value })}
                        />
                      </td>
                      <td className="w-20 px-2 py-2">
                        <Input
                          aria-label={`Item ${i + 1} quantity`}
                          inputMode="decimal"
                          className="text-right"
                          value={l.quantity}
                          onChange={(e) => setLine(i, { quantity: e.target.value })}
                        />
                      </td>
                      <td className="w-28 px-2 py-2">
                        <Input
                          aria-label={`Item ${i + 1} rate`}
                          inputMode="decimal"
                          className="text-right"
                          value={l.rate}
                          onChange={(e) => setLine(i, { rate: e.target.value })}
                        />
                      </td>
                      <td className="w-20 px-2 py-2">
                        <Input
                          aria-label={`Item ${i + 1} discount percent`}
                          inputMode="decimal"
                          className="text-right"
                          value={l.discountPct}
                          onChange={(e) => setLine(i, { discountPct: e.target.value })}
                        />
                      </td>
                      <td className="w-24 px-2 py-2">
                        <Select
                          aria-label={`Item ${i + 1} GST rate`}
                          value={l.gstRate}
                          onChange={(e) => setLine(i, { gstRate: e.target.value })}
                        >
                          {GST_RATES.map((r) => (
                            <option key={r} value={r}>
                              {r}%
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="w-28 py-2 pl-2 pt-4 text-right tabular-nums">
                        {(totals.lines[i]?.amount ?? 0).toFixed(2)}
                      </td>
                      <td className="py-2 pl-2">
                        {d.lines.length > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove item ${i + 1}`}
                            onClick={() => set({ lines: d.lines.filter((_, j) => j !== i) })}
                          >
                            Remove
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => set({ lines: [...d.lines, { ...blankLine }] })}
              >
                Add item
              </Button>
            </div>
          </section>

          <section
            aria-labelledby="doc-notes"
            className="grid gap-4 rounded-lg border border-border bg-card p-5"
          >
            <h2 id="doc-notes" className="text-base font-semibold">
              Notes and terms
            </h2>
            <Field id="d-note" label="Note to customer">
              <textarea
                id="d-note"
                rows={2}
                className="rounded-md border border-input bg-card px-3 py-2"
                value={d.note}
                onChange={(e) => set({ note: e.target.value })}
              />
            </Field>
            <Field id="d-terms" label="Terms">
              <textarea
                id="d-terms"
                rows={2}
                className="rounded-md border border-input bg-card px-3 py-2"
                value={d.terms}
                onChange={(e) => set({ terms: e.target.value })}
              />
            </Field>
          </section>
        </div>

        <aside aria-label="Preview" className="flex min-w-0 max-w-[480px] flex-[1_1_360px] flex-col gap-2">
          <div className="text-[13px] font-medium text-muted-foreground">
            Preview · {template?.name ?? 'Default'} template
          </div>
          <DocumentPreview
            template={template}
            doc={{
              type,
              number: existing?.number ?? null,
              date: d.date,
              dueDate: d.dueDate || null,
              poNumber: d.poNumber || null,
              companyName: companies.data?.find((c) => c.id === companyId)?.name ?? '',
              seller: settings.data ?? null,
              customer: customer
                ? {
                    name: customer.name,
                    gstin: customer.gstin,
                    billingAddress: customer.billingAddress,
                    stateCode: customer.stateCode,
                  }
                : null,
              placeOfSupply: pos || null,
              lines: previewLines,
              subtotal: totals.subtotal,
              cgst: totals.cgst,
              sgst: totals.sgst,
              igst: totals.igst,
              total: totals.total,
              amountInWords: amountInWords(totals.total),
              note: d.note || null,
              terms: d.terms || null,
            }}
          />
        </aside>
      </div>
    </>
  );
}
