'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { errorMessage, useCompanies } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { expenseKeys, type Vendor } from '@/lib/expenses';
import {
  procurementKeys,
  useApprovedRequests,
  type PurchaseOrder,
  type PurchaseRequest,
} from '@/lib/procurement';

const today = () => new Date().toISOString().slice(0, 10);
const paise = (v: string) => Math.round((Number(v) || 0) * 100);

interface RequestRowState {
  key: number;
  description: string;
  quantity: string;
  price: string;
}

/** Ask for something to be bought: what, how many and roughly what it costs. */
export function RequestDialog({
  request,
  onClose,
  onSaved,
}: {
  request?: PurchaseRequest | undefined;
  onClose: () => void;
  onSaved: (r: PurchaseRequest) => void;
}) {
  const client = useQueryClient();
  const [title, setTitle] = useState(request?.title ?? '');
  const [why, setWhy] = useState(request?.justification ?? '');
  const [seq, setSeq] = useState(10);
  const [rows, setRows] = useState<RequestRowState[]>(
    request
      ? request.lines.map((l, i) => ({
          key: i,
          description: l.description,
          quantity: String(l.quantity),
          price: String(l.estimatedUnitPrice),
        }))
      : [{ key: 0, description: '', quantity: '1', price: '' }],
  );
  const total = rows.reduce((s, r) => s + Math.round((Number(r.quantity) || 0) * paise(r.price)), 0) / 100;
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title,
        justification: why,
        lines: rows.map((r) => ({
          description: r.description,
          quantity: Number(r.quantity),
          estimatedUnitPrice: Number(r.price),
        })),
      };
      return request
        ? apiFetch<PurchaseRequest>(`/v1/procurement/requests/${request.id}`, { method: 'PUT', body })
        : apiFetch<PurchaseRequest>('/v1/procurement/requests', { method: 'POST', body });
    },
    onSuccess: async (r) => {
      await client.invalidateQueries({ queryKey: procurementKeys.all });
      onSaved(r);
    },
  });
  const update = (key: number, patch: Partial<RequestRowState>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <Dialog
      open
      onClose={onClose}
      title={request ? 'Edit purchase request' : 'New purchase request'}
      description="Saving keeps it as a draft; send it for approval when it’s ready."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !title || total <= 0} onClick={() => save.mutate()}>
            Save draft
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <Field id="pr-title" label="What do you need?">
          <Input id="pr-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field id="pr-why" label="Why" hint="Optional">
          <Input id="pr-why" value={why} onChange={(e) => setWhy(e.target.value)} />
        </Field>
        {rows.map((r, i) => (
          <fieldset key={r.key} className="grid grid-cols-[1fr_80px_110px_auto] gap-2">
            <legend className="sr-only">Item {i + 1}</legend>
            <Input
              aria-label={`Item ${i + 1} description`}
              placeholder="Item"
              value={r.description}
              onChange={(e) => update(r.key, { description: e.target.value })}
            />
            <Input
              aria-label={`Item ${i + 1} quantity`}
              inputMode="decimal"
              className="text-right tabular-nums"
              value={r.quantity}
              onChange={(e) => update(r.key, { quantity: e.target.value })}
            />
            <Input
              aria-label={`Item ${i + 1} estimated price`}
              inputMode="decimal"
              placeholder="Unit price"
              className="text-right tabular-nums"
              value={r.price}
              onChange={(e) => update(r.key, { price: e.target.value })}
            />
            <Button
              variant="outline"
              aria-label={`Remove item ${i + 1}`}
              disabled={rows.length <= 1}
              onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </fieldset>
        ))}
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setRows((rs) => [...rs, { key: seq, description: '', quantity: '1', price: '' }]);
              setSeq((s) => s + 1);
            }}
          >
            <Plus className="size-4" aria-hidden /> Add item
          </Button>
          <p className="text-sm font-medium tabular-nums" aria-live="polite">
            Estimated total {total.toFixed(2)}
          </p>
        </div>
      </div>
    </Dialog>
  );
}

interface OrderRowState {
  key: number;
  description: string;
  quantity: string;
  price: string;
  tax: string;
}

/** Draft or edit a purchase order to a vendor. Totals and tax are worked out as you type. */
export function OrderDialog({
  order,
  fromRequest,
  onClose,
  onSaved,
}: {
  order?: PurchaseOrder | undefined;
  fromRequest?: PurchaseRequest | undefined;
  onClose: () => void;
  onSaved: (o: PurchaseOrder) => void;
}) {
  const client = useQueryClient();
  const companies = useCompanies();
  const vendors = useQuery({
    queryKey: [...expenseKeys.vendors, 'active'],
    queryFn: () => apiFetch<Vendor[]>('/v1/vendors?status=ACTIVE'),
  });
  const approved = useApprovedRequests(!order && !fromRequest);
  const [companyId, setCompanyId] = useState(order?.companyId ?? '');
  const [vendorId, setVendorId] = useState(order?.vendor.id ?? '');
  const [requestId, setRequestId] = useState(fromRequest?.id ?? '');
  const [orderDate, setOrderDate] = useState(order?.orderDate ?? today());
  const [expected, setExpected] = useState(order?.expectedDate ?? '');
  const [terms, setTerms] = useState(order?.terms ?? '');
  const [seq, setSeq] = useState(10);
  const [rows, setRows] = useState<OrderRowState[]>(
    order
      ? order.lines.map((l, i) => ({
          key: i,
          description: l.description,
          quantity: String(l.quantity),
          price: String(l.unitPrice),
          tax: String(l.taxRate),
        }))
      : fromRequest
        ? fromRequest.lines.map((l, i) => ({
            key: i,
            description: l.description,
            quantity: String(l.quantity),
            price: String(l.estimatedUnitPrice),
            tax: '0',
          }))
        : [{ key: 0, description: '', quantity: '1', price: '', tax: '0' }],
  );
  const net = rows.reduce((s, r) => s + Math.round((Number(r.quantity) || 0) * paise(r.price)), 0);
  const tax = rows.reduce(
    (s, r) =>
      s + Math.round((Math.round((Number(r.quantity) || 0) * paise(r.price)) * (Number(r.tax) || 0)) / 100),
    0,
  );
  const company = companyId || companies.data?.[0]?.id || '';
  const save = useMutation({
    mutationFn: () => {
      const lines = rows.map((r) => ({
        description: r.description,
        quantity: Number(r.quantity),
        unitPrice: Number(r.price),
        taxRate: Number(r.tax) || 0,
      }));
      const shared = { vendorId, orderDate, expectedDate: expected, terms, lines };
      return order
        ? apiFetch<PurchaseOrder>(`/v1/procurement/orders/${order.id}`, { method: 'PUT', body: shared })
        : apiFetch<PurchaseOrder>('/v1/procurement/orders', {
            method: 'POST',
            body: { ...shared, companyId: company, requestId: requestId || null },
          });
    },
    onSuccess: async (o) => {
      await client.invalidateQueries({ queryKey: procurementKeys.all });
      onSaved(o);
    },
  });
  const update = (key: number, patch: Partial<OrderRowState>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <Dialog
      open
      onClose={onClose}
      title={order ? 'Edit purchase order' : 'New purchase order'}
      description="Saving keeps it as a draft; it goes to the vendor’s record once approved."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || !vendorId || !company || net <= 0}
            onClick={() => save.mutate()}
          >
            Save draft
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          {!order && (companies.data?.length ?? 0) !== 1 && (
            <Field id="po-company" label="Company">
              <Select id="po-company" value={company} onChange={(e) => setCompanyId(e.target.value)}>
                {(companies.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field id="po-vendor" label="Vendor">
            <Select id="po-vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">Choose a vendor</option>
              {(vendors.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
          {!order && !fromRequest && (approved.data?.length ?? 0) > 0 && (
            <Field id="po-request" label="From an approved request" hint="Optional">
              <Select id="po-request" value={requestId} onChange={(e) => setRequestId(e.target.value)}>
                <option value="">None</option>
                {(approved.data ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.number} · {r.title}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field id="po-date" label="Order date">
            <Input
              id="po-date"
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
            />
          </Field>
          <Field id="po-expected" label="Expected by" hint="Optional">
            <Input
              id="po-expected"
              type="date"
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
            />
          </Field>
        </div>
        {rows.map((r, i) => (
          <fieldset key={r.key} className="grid grid-cols-[1fr_70px_100px_60px_auto] gap-2">
            <legend className="sr-only">Item {i + 1}</legend>
            <Input
              aria-label={`Item ${i + 1} description`}
              placeholder="Item"
              value={r.description}
              onChange={(e) => update(r.key, { description: e.target.value })}
            />
            <Input
              aria-label={`Item ${i + 1} quantity`}
              inputMode="decimal"
              className="text-right tabular-nums"
              value={r.quantity}
              onChange={(e) => update(r.key, { quantity: e.target.value })}
            />
            <Input
              aria-label={`Item ${i + 1} unit price`}
              inputMode="decimal"
              placeholder="Price"
              className="text-right tabular-nums"
              value={r.price}
              onChange={(e) => update(r.key, { price: e.target.value })}
            />
            <Input
              aria-label={`Item ${i + 1} tax percent`}
              inputMode="decimal"
              placeholder="Tax %"
              className="text-right tabular-nums"
              value={r.tax}
              onChange={(e) => update(r.key, { tax: e.target.value })}
            />
            <Button
              variant="outline"
              aria-label={`Remove item ${i + 1}`}
              disabled={rows.length <= 1}
              onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </fieldset>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setRows((rs) => [...rs, { key: seq, description: '', quantity: '1', price: '', tax: '0' }]);
              setSeq((s) => s + 1);
            }}
          >
            <Plus className="size-4" aria-hidden /> Add item
          </Button>
          <p className="text-sm tabular-nums" aria-live="polite">
            Subtotal {(net / 100).toFixed(2)} · Tax {(tax / 100).toFixed(2)} ·{' '}
            <span className="font-medium">Total {((net + tax) / 100).toFixed(2)}</span>
          </p>
        </div>
        <Field id="po-terms" label="Terms" hint="Optional">
          <Input id="po-terms" value={terms} onChange={(e) => setTerms(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/** Record what arrived. Each line starts at what is still outstanding. */
export function ReceiveDialog({ order, onClose }: { order: PurchaseOrder; onClose: () => void }) {
  const client = useQueryClient();
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const open = order.lines.filter((l) => l.quantity - l.receivedQuantity > 0);
  const save = useMutation({
    mutationFn: () =>
      apiFetch<PurchaseOrder>(`/v1/procurement/orders/${order.id}/receive`, {
        method: 'POST',
        body: {
          receivedOn: date,
          note,
          lines: open
            .filter((l) => Number(qty[l.id]) > 0)
            .map((l) => ({ orderLineId: l.id, quantity: Number(qty[l.id]) })),
        },
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: procurementKeys.all });
      onClose();
    },
  });
  const any = open.some((l) => Number(qty[l.id]) > 0);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Goods received"
      description="Enter how much of each item arrived. You can receive in parts."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !any} onClick={() => save.mutate()}>
            Record
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <Field id="grn-date" label="Received on">
          <Input id="grn-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {open.map((l) => (
          <div key={l.id} className="grid grid-cols-[1fr_110px] items-center gap-2">
            <label htmlFor={`grn-${l.id}`} className="text-sm">
              {l.description}
              <span className="block text-xs text-muted-foreground">
                {l.quantity - l.receivedQuantity} still to receive
              </span>
            </label>
            <Input
              id={`grn-${l.id}`}
              inputMode="decimal"
              className="text-right tabular-nums"
              value={qty[l.id] ?? ''}
              onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
            />
          </div>
        ))}
        <Field id="grn-note" label="Note" hint="Optional">
          <Input id="grn-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
