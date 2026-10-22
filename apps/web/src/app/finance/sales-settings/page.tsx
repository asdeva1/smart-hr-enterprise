'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { useBooksCompany } from '@/lib/finance';
import { can } from '@/lib/permissions';
import { GST_STATES, salesKeys, type Seller } from '@/lib/sales';
import { CompanyPicker, FinancePage, SalesTabs } from '../finance-page';

export default function SalesSettingsPage() {
  return (
    <FinancePage active="Invoices">
      {(session) => <Settings canConfigure={can(session, 'finance.configure')} />}
    </FinancePage>
  );
}

function Settings({ canConfigure }: { canConfigure: boolean }) {
  const [companyId, setCompanyId] = useBooksCompany();
  const q = useQuery({
    queryKey: salesKeys.settings(companyId),
    queryFn: () => apiFetch<Partial<Seller>>(`/v1/finance/sales/settings/${companyId}`),
    enabled: !!companyId,
  });
  return (
    <>
      <PageHeader
        title="Business details"
        description="Your tax and bank details, printed on invoices and used to split GST."
      />
      <SalesTabs active="/finance/sales-settings" />
      <CompanyPicker value={companyId} onChange={setCompanyId} />
      {!companyId || q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <Alert tone="error">{errorMessage(q.error)}</Alert>
      ) : (
        <Form key={companyId} companyId={companyId} initial={q.data} canConfigure={canConfigure} />
      )}
    </>
  );
}

function Form({
  companyId,
  initial,
  canConfigure,
}: {
  companyId: string;
  initial: Partial<Seller>;
  canConfigure: boolean;
}) {
  const client = useQueryClient();
  const [f, setF] = useState({
    gstin: initial.gstin ?? '',
    pan: initial.pan ?? '',
    stateCode: initial.stateCode ?? '',
    address: initial.address ?? '',
    bankName: initial.bankName ?? '',
    bankAccountNo: initial.bankAccountNo ?? '',
    bankIfsc: initial.bankIfsc ?? '',
    upiId: initial.upiId ?? '',
    signatory: initial.signatory ?? '',
  });
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));
  const save = useMutation({
    mutationFn: () => apiFetch(`/v1/finance/sales/settings/${companyId}`, { method: 'PUT', body: f }),
    onSuccess: () => client.invalidateQueries({ queryKey: salesKeys.all }),
  });
  return (
    <form
      className="grid max-w-3xl gap-4 rounded-lg border border-border bg-card p-5 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      {save.isError && (
        <div className="sm:col-span-2">
          <Alert tone="error">{errorMessage(save.error)}</Alert>
        </div>
      )}
      {save.isSuccess && (
        <div className="sm:col-span-2">
          <Alert tone="success">Saved.</Alert>
        </div>
      )}
      <Field id="s-gstin" label="GSTIN" hint="Sets your state, which decides CGST+SGST or IGST">
        <Input
          id="s-gstin"
          disabled={!canConfigure}
          value={f.gstin}
          onChange={(e) => set({ gstin: e.target.value })}
        />
      </Field>
      <Field id="s-pan" label="PAN">
        <Input
          id="s-pan"
          disabled={!canConfigure}
          value={f.pan}
          onChange={(e) => set({ pan: e.target.value })}
        />
      </Field>
      <Field id="s-state" label="State">
        <Select
          id="s-state"
          disabled={!canConfigure}
          value={f.stateCode}
          onChange={(e) => set({ stateCode: e.target.value })}
        >
          <option value="">From the GSTIN</option>
          {Object.entries(GST_STATES).map(([code, name]) => (
            <option key={code} value={code}>
              {name} ({code})
            </option>
          ))}
        </Select>
      </Field>
      <Field id="s-signatory" label="Authorised signatory">
        <Input
          id="s-signatory"
          disabled={!canConfigure}
          value={f.signatory}
          onChange={(e) => set({ signatory: e.target.value })}
        />
      </Field>
      <div className="sm:col-span-2">
        <Field id="s-address" label="Address on documents">
          <textarea
            id="s-address"
            rows={3}
            disabled={!canConfigure}
            className="w-full rounded-md border border-input bg-card px-3 py-2"
            value={f.address}
            onChange={(e) => set({ address: e.target.value })}
          />
        </Field>
      </div>
      <Field id="s-bank" label="Bank name">
        <Input
          id="s-bank"
          disabled={!canConfigure}
          value={f.bankName}
          onChange={(e) => set({ bankName: e.target.value })}
        />
      </Field>
      <Field id="s-acct" label="Account number">
        <Input
          id="s-acct"
          disabled={!canConfigure}
          value={f.bankAccountNo}
          onChange={(e) => set({ bankAccountNo: e.target.value })}
        />
      </Field>
      <Field id="s-ifsc" label="IFSC">
        <Input
          id="s-ifsc"
          disabled={!canConfigure}
          value={f.bankIfsc}
          onChange={(e) => set({ bankIfsc: e.target.value })}
        />
      </Field>
      <Field id="s-upi" label="UPI ID">
        <Input
          id="s-upi"
          disabled={!canConfigure}
          value={f.upiId}
          onChange={(e) => set({ upiId: e.target.value })}
        />
      </Field>
      {canConfigure && (
        <div className="sm:col-span-2">
          <Button type="submit" disabled={save.isPending}>
            Save details
          </Button>
        </div>
      )}
    </form>
  );
}
