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
import { assetKeys, fetchPeople, type Asset } from '@/lib/assets';
import { expenseKeys, type Vendor } from '@/lib/expenses';

const today = () => new Date().toISOString().slice(0, 10);

/** Add an asset to the register. */
export function AssetDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (a: Asset) => void }) {
  const client = useQueryClient();
  const companies = useCompanies();
  const vendors = useQuery({
    queryKey: [...expenseKeys.vendors, 'all-active'],
    queryFn: () => apiFetch<Vendor[]>('/v1/vendors?status=ACTIVE'),
    retry: false,
  });
  const [f, setF] = useState({
    companyId: '',
    tag: '',
    name: '',
    category: '',
    serialNumber: '',
    vendorId: '',
    purchaseDate: today(),
    purchaseCost: '',
    salvageValue: '0',
    usefulLifeMonths: '36',
    notes: '',
  });
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));
  const company = f.companyId || companies.data?.[0]?.id || '';
  const save = useMutation({
    mutationFn: () =>
      apiFetch<Asset>('/v1/assets', {
        method: 'POST',
        body: {
          ...f,
          companyId: company,
          purchaseCost: Number(f.purchaseCost),
          salvageValue: Number(f.salvageValue) || 0,
          usefulLifeMonths: Number(f.usefulLifeMonths),
        },
      }),
    onSuccess: async (a) => {
      await client.invalidateQueries({ queryKey: assetKeys.all });
      onSaved(a);
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add asset"
      description="Depreciation is worked out in a straight line from the cost, resale value and useful life."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || !f.tag || !f.name || !f.category || !f.purchaseCost || !company}
            onClick={() => save.mutate()}
          >
            Add asset
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
        <Field id="a-tag" label="Asset tag" hint="The label on the item, e.g. LAP-0042">
          <Input id="a-tag" value={f.tag} onChange={(e) => set({ tag: e.target.value })} />
        </Field>
        {(companies.data?.length ?? 0) !== 1 && (
          <Field id="a-company" label="Company">
            <Select id="a-company" value={company} onChange={(e) => set({ companyId: e.target.value })}>
              {(companies.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field id="a-name" label="Name">
          <Input id="a-name" value={f.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field id="a-category" label="Category" hint="e.g. IT equipment, Furniture">
          <Input id="a-category" value={f.category} onChange={(e) => set({ category: e.target.value })} />
        </Field>
        <Field id="a-serial" label="Serial number">
          <Input
            id="a-serial"
            value={f.serialNumber}
            onChange={(e) => set({ serialNumber: e.target.value })}
          />
        </Field>
        {vendors.data && (
          <Field id="a-vendor" label="Bought from">
            <Select id="a-vendor" value={f.vendorId} onChange={(e) => set({ vendorId: e.target.value })}>
              <option value="">Not recorded</option>
              {vendors.data.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field id="a-date" label="Purchase date">
          <Input
            id="a-date"
            type="date"
            value={f.purchaseDate}
            onChange={(e) => set({ purchaseDate: e.target.value })}
          />
        </Field>
        <Field id="a-cost" label="Cost">
          <Input
            id="a-cost"
            inputMode="decimal"
            value={f.purchaseCost}
            onChange={(e) => set({ purchaseCost: e.target.value })}
          />
        </Field>
        <Field id="a-salvage" label="Resale value at end of life">
          <Input
            id="a-salvage"
            inputMode="decimal"
            value={f.salvageValue}
            onChange={(e) => set({ salvageValue: e.target.value })}
          />
        </Field>
        <Field id="a-life" label="Useful life (months)">
          <Input
            id="a-life"
            inputMode="numeric"
            value={f.usefulLifeMonths}
            onChange={(e) => set({ usefulLifeMonths: e.target.value })}
          />
        </Field>
      </div>
    </Dialog>
  );
}

/** Give an asset to an employee, found by typing part of their name or code. */
export function AssignDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [condition, setCondition] = useState('');
  const [on, setOn] = useState(today());
  const people = useQuery({
    queryKey: ['assets', 'people', search],
    queryFn: () => fetchPeople(search),
    enabled: search.trim().length >= 2,
  });
  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/assets/${asset.id}/assign`, {
        method: 'POST',
        body: { employeeId, assignedOn: on, condition },
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: assetKeys.all });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Give out ${asset.tag}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !employeeId} onClick={() => save.mutate()}>
            Give out
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <Field
          id="as-search"
          label="Find the employee"
          hint="Type at least two letters of their name or code"
        >
          <Input id="as-search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        {people.data && (
          <Field id="as-person" label="Employee">
            <Select id="as-person" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Choose…</option>
              {people.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field id="as-on" label="Given on">
          <Input id="as-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
        </Field>
        <Field id="as-cond" label="Condition" hint="Optional">
          <Input id="as-cond" value={condition} onChange={(e) => setCondition(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/** Take an asset back, noting its condition and whether it needs repair. */
export function ReturnDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const client = useQueryClient();
  const [condition, setCondition] = useState('');
  const [repair, setRepair] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/assets/${asset.id}/return`, { method: 'POST', body: { condition, needsRepair: repair } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: assetKeys.all });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Take back ${asset.tag}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Take back
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <Field id="rt-cond" label="Condition" hint="Optional">
          <Input id="rt-cond" value={condition} onChange={(e) => setCondition(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={repair} onChange={(e) => setRepair(e.target.checked)} />
          It needs repair before it is given out again
        </label>
      </div>
    </Dialog>
  );
}

/** Retire an asset that is no longer in use. Depreciation stops from that date. */
export function RetireDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const client = useQueryClient();
  const [reason, setReason] = useState('');
  const [on, setOn] = useState(today());
  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/assets/${asset.id}/retire`, { method: 'POST', body: { reason, retiredOn: on } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: assetKeys.all });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Retire ${asset.tag}`}
      description="A retired asset stays in the register for the record but can’t be given out again."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || reason.trim().length < 3} onClick={() => save.mutate()}>
            Retire
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <Field id="rf-reason" label="Why">
          <Input id="rf-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field id="rf-on" label="Retired on">
          <Input id="rf-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
