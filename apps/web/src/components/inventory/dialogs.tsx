'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { errorMessage, useCompanies } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { inventoryKeys, type InventoryItem, type Warehouse } from '@/lib/inventory';

const today = () => new Date().toISOString().slice(0, 10);

export function useWarehouses() {
  return useQuery({
    queryKey: inventoryKeys.warehouses,
    queryFn: () => apiFetch<Warehouse[]>('/v1/inventory/warehouses'),
  });
}
export function useItems() {
  return useQuery({
    queryKey: inventoryKeys.items,
    queryFn: () => apiFetch<InventoryItem[]>('/v1/inventory/items'),
  });
}

function useSave(request: () => Promise<unknown>, onDone: () => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: inventoryKeys.all });
      onDone();
    },
  });
}

/** Add or change an item. The SKU can't change once the item exists. */
export function ItemDialog({ item, onClose }: { item?: InventoryItem | undefined; onClose: () => void }) {
  const [f, setF] = useState({
    sku: item?.sku ?? '',
    name: item?.name ?? '',
    unit: item?.unit ?? 'pcs',
    category: item?.category ?? '',
    reorderLevel: item?.reorderLevel === null || !item ? '' : String(item.reorderLevel),
    standardCost: String(item?.standardCost ?? 0),
    archived: item?.status === 'ARCHIVED',
  });
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));
  const save = useSave(() => {
    const body = {
      name: f.name,
      unit: f.unit,
      category: f.category,
      reorderLevel: f.reorderLevel === '' ? null : Number(f.reorderLevel),
      standardCost: Number(f.standardCost) || 0,
    };
    return item
      ? apiFetch(`/v1/inventory/items/${item.id}`, {
          method: 'PATCH',
          body: { ...body, status: f.archived ? 'ARCHIVED' : 'ACTIVE' },
        })
      : apiFetch('/v1/inventory/items', { method: 'POST', body: { ...body, sku: f.sku } });
  }, onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      title={item ? 'Edit item' : 'Add item'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !f.name || (!item && !f.sku)} onClick={() => save.mutate()}>
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
        {!item && (
          <Field id="i-sku" label="SKU" hint="A short unique code">
            <Input id="i-sku" value={f.sku} onChange={(e) => set({ sku: e.target.value })} />
          </Field>
        )}
        <Field id="i-name" label="Name">
          <Input id="i-name" value={f.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field id="i-unit" label="Counted in" hint="pcs, kg, box, litre">
          <Input id="i-unit" value={f.unit} onChange={(e) => set({ unit: e.target.value })} />
        </Field>
        <Field id="i-cat" label="Category">
          <Input id="i-cat" value={f.category} onChange={(e) => set({ category: e.target.value })} />
        </Field>
        <Field id="i-reorder" label="Reorder when stock falls to" hint="Optional">
          <Input
            id="i-reorder"
            inputMode="decimal"
            value={f.reorderLevel}
            onChange={(e) => set({ reorderLevel: e.target.value })}
          />
        </Field>
        <Field id="i-cost" label="Value per unit" hint="Used for stock value">
          <Input
            id="i-cost"
            inputMode="decimal"
            value={f.standardCost}
            onChange={(e) => set({ standardCost: e.target.value })}
          />
        </Field>
        {item && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={f.archived}
              onChange={(e) => set({ archived: e.target.checked })}
            />
            Archived (no longer stocked)
          </label>
        )}
      </div>
    </Dialog>
  );
}

/** Add or change a warehouse. */
export function WarehouseDialog({
  warehouse,
  onClose,
}: {
  warehouse?: Warehouse | undefined;
  onClose: () => void;
}) {
  const companies = useCompanies();
  const [f, setF] = useState({
    companyId: '',
    code: warehouse?.code ?? '',
    name: warehouse?.name ?? '',
    address: warehouse?.address ?? '',
    archived: warehouse?.status === 'ARCHIVED',
  });
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));
  const company = f.companyId || companies.data?.[0]?.id || '';
  const save = useSave(() => {
    return warehouse
      ? apiFetch(`/v1/inventory/warehouses/${warehouse.id}`, {
          method: 'PATCH',
          body: { name: f.name, address: f.address, status: f.archived ? 'ARCHIVED' : 'ACTIVE' },
        })
      : apiFetch('/v1/inventory/warehouses', {
          method: 'POST',
          body: { companyId: company, code: f.code, name: f.name, address: f.address },
        });
  }, onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      title={warehouse ? 'Edit warehouse' : 'Add warehouse'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || !f.name || (!warehouse && (!f.code || !company))}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        {!warehouse && (
          <>
            <Field id="w-company" label="Company">
              <Select id="w-company" value={company} onChange={(e) => set({ companyId: e.target.value })}>
                {(companies.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="w-code" label="Code">
              <Input id="w-code" value={f.code} onChange={(e) => set({ code: e.target.value })} />
            </Field>
          </>
        )}
        <Field id="w-name" label="Name">
          <Input id="w-name" value={f.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field id="w-address" label="Address">
          <Input id="w-address" value={f.address} onChange={(e) => set({ address: e.target.value })} />
        </Field>
        {warehouse && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.archived}
              onChange={(e) => set({ archived: e.target.checked })}
            />
            Archived (no more stock can go in)
          </label>
        )}
      </div>
    </Dialog>
  );
}

export type MovementMode = 'receipt' | 'issue' | 'adjustment' | 'transfer';

const TITLE: Record<MovementMode, string> = {
  receipt: 'Receive stock',
  issue: 'Issue stock',
  adjustment: 'Adjust stock after a count',
  transfer: 'Move stock between warehouses',
};

/** One dialog for every way stock changes. The server refuses anything that would take stock below zero. */
export function MovementDialog({
  mode,
  itemId,
  warehouseId,
  onClose,
}: {
  mode: MovementMode;
  itemId?: string | undefined;
  warehouseId?: string | undefined;
  onClose: () => void;
}) {
  const items = useItems();
  const warehouses = useWarehouses();
  const active = (warehouses.data ?? []).filter((w) => w.status === 'ACTIVE');
  const [item, setItem] = useState(itemId ?? '');
  const [warehouse, setWarehouse] = useState(warehouseId ?? '');
  const [toWarehouse, setToWarehouse] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [on, setOn] = useState(today());
  const save = useSave(() => {
    const common = { itemId: item, occurredOn: on, reference, note };
    switch (mode) {
      case 'receipt':
        return apiFetch('/v1/inventory/receipts', {
          method: 'POST',
          body: { ...common, warehouseId: warehouse, quantity: Number(quantity), unitCost },
        });
      case 'issue':
        return apiFetch('/v1/inventory/issues', {
          method: 'POST',
          body: { ...common, warehouseId: warehouse, quantity: Number(quantity) },
        });
      case 'adjustment':
        return apiFetch('/v1/inventory/adjustments', {
          method: 'POST',
          body: { ...common, warehouseId: warehouse, quantity: Number(quantity) },
        });
      case 'transfer':
        return apiFetch('/v1/inventory/transfers', {
          method: 'POST',
          body: {
            ...common,
            fromWarehouseId: warehouse,
            toWarehouseId: toWarehouse,
            quantity: Number(quantity),
          },
        });
    }
  }, onClose);
  const ready =
    item &&
    warehouse &&
    Number(quantity) !== 0 &&
    !Number.isNaN(Number(quantity)) &&
    (mode !== 'transfer' || toWarehouse);
  return (
    <Dialog
      open
      onClose={onClose}
      title={TITLE[mode]}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !ready} onClick={() => save.mutate()}>
            Record
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <Field id="m-item" label="Item">
          <Select id="m-item" value={item} onChange={(e) => setItem(e.target.value)}>
            <option value="">Choose an item</option>
            {(items.data ?? [])
              .filter((i) => i.status === 'ACTIVE')
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.sku} · {i.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field id="m-wh" label={mode === 'transfer' ? 'From warehouse' : 'Warehouse'}>
          <Select id="m-wh" value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
            <option value="">Choose a warehouse</option>
            {active.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </Field>
        {mode === 'transfer' && (
          <Field id="m-to" label="To warehouse">
            <Select id="m-to" value={toWarehouse} onChange={(e) => setToWarehouse(e.target.value)}>
              <option value="">Choose a warehouse</option>
              {active
                .filter((w) => w.id !== warehouse)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="m-qty"
            label="Quantity"
            hint={mode === 'adjustment' ? 'Plus to add, minus to remove' : undefined}
          >
            <Input
              id="m-qty"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
          <Field id="m-on" label="Date">
            <Input id="m-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
          </Field>
          {mode === 'receipt' && (
            <Field id="m-cost" label="Cost per unit" hint="Optional">
              <Input
                id="m-cost"
                inputMode="decimal"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
              />
            </Field>
          )}
          <Field id="m-ref" label="Reference" hint="A GRN, job or document number">
            <Input id="m-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
        <Field id="m-note" label={mode === 'adjustment' ? 'Why' : 'Note'}>
          <Input id="m-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
