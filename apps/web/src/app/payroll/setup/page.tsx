'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage, useCompanies } from '@/lib/admin';
import { ApiError, apiFetch } from '@/lib/api';
import { payrollKeys, rupees, usePayComponents, type PayComponent } from '@/lib/payroll';
import { PayrollPage, PayrollTabs } from '../payroll-page';

export default function PayrollSetupPage() {
  return (
    <PayrollPage permission="payroll.configure">
      {(session) => (
        <>
          <PageHeader
            title="Payroll"
            description="Pay components, statutory registrations per company, and professional tax."
          />
          <PayrollTabs session={session} active="/payroll/setup" />
          <Components />
          <CompanySettings />
          <ProfessionalTax />
        </>
      )}
    </PayrollPage>
  );
}

function Components() {
  const components = usePayComponents();
  const [adding, setAdding] = useState(false);
  const yes = (b: boolean) => (b ? 'Yes' : '—');
  return (
    <section aria-labelledby="components-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="components-heading" className="text-[17px] font-semibold">
          Pay components
        </h2>
        <Button variant="outline" onClick={() => setAdding(true)}>
          Add component
        </Button>
      </div>
      {components.isPending ? (
        <Loading />
      ) : components.isError ? (
        <Alert tone="error">{errorMessage(components.error)}</Alert>
      ) : (
        <Table label="Pay components">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Kind</Th>
              <Th>Taxable</Th>
              <Th>PF wages</Th>
              <Th>ESI wages</Th>
              <Th>Prorated</Th>
            </tr>
          </thead>
          <tbody>
            {components.data.map((c) => (
              <tr key={c.id}>
                <Td className="font-mono text-[13px]">{c.code}</Td>
                <Td>
                  {c.name} {c.status === 'ARCHIVED' && <Badge>Archived</Badge>}
                </Td>
                <Td>{c.kind === 'EARNING' ? 'Earning' : 'Deduction'}</Td>
                <Td>{yes(c.taxable)}</Td>
                <Td>{yes(c.pfWage)}</Td>
                <Td>{yes(c.esiWage)}</Td>
                <Td>{yes(c.prorate)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {adding && <ComponentDialog onClose={() => setAdding(false)} />}
    </section>
  );
}

function ComponentDialog({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [v, setV] = useState({
    code: '',
    name: '',
    kind: 'EARNING' as PayComponent['kind'],
    taxable: true,
    pfWage: false,
    esiWage: true,
    prorate: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => apiFetch<PayComponent>('/v1/payroll/components', { method: 'POST', body: v }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: payrollKeys.components });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.length)
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
    },
  });
  const check = (key: 'taxable' | 'pfWage' | 'esiWage' | 'prorate', label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={v[key]}
        onChange={(e) => setV((x) => ({ ...x, [key]: e.target.checked }))}
      />
      {label}
    </label>
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a pay component"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={m.isPending} onClick={() => m.mutate()}>
            Add
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {m.isError && !Object.keys(errors).length && <Alert tone="error">{errorMessage(m.error)}</Alert>}
        <Field id="pc-code" label="Code" error={errors.code}>
          <Input
            {...fieldAria('pc-code', errors.code)}
            value={v.code}
            onChange={(e) => setV((x) => ({ ...x, code: e.target.value }))}
          />
        </Field>
        <Field id="pc-name" label="Name" error={errors.name}>
          <Input
            {...fieldAria('pc-name', errors.name)}
            value={v.name}
            onChange={(e) => setV((x) => ({ ...x, name: e.target.value }))}
          />
        </Field>
        <Field id="pc-kind" label="Kind">
          <Select
            id="pc-kind"
            value={v.kind}
            onChange={(e) => setV((x) => ({ ...x, kind: e.target.value as PayComponent['kind'] }))}
          >
            <option value="EARNING">Earning</option>
            <option value="DEDUCTION">Deduction</option>
          </Select>
        </Field>
        {check('taxable', 'Taxable')}
        {check('pfWage', 'Counts as wages for PF (basic, dearness or retaining allowance)')}
        {check('esiWage', 'Counts towards ESI wages')}
        {check('prorate', 'Reduced for unpaid days')}
      </div>
    </Dialog>
  );
}

interface Settings {
  pfEnabled: boolean;
  esiEnabled: boolean;
  labourCodeWages: boolean;
  pfEstablishmentId: string | null;
  esiEmployerCode: string | null;
  tan: string | null;
  statutory: boolean;
}

function CompanySettings() {
  const companies = useCompanies();
  const [companyId, setCompanyId] = useState('');
  const company = companyId || companies.data?.[0]?.id || '';
  const settings = useQuery({
    queryKey: payrollKeys.settings(company),
    queryFn: () => apiFetch<Settings>(`/v1/payroll/settings/${company}`),
    enabled: !!company,
  });
  return (
    <section aria-labelledby="statutory-heading" className="flex flex-col gap-3">
      <h2 id="statutory-heading" className="text-[17px] font-semibold">
        Statutory settings
      </h2>
      <div className="max-w-xs">
        <Field id="st-company" label="Company">
          <Select id="st-company" value={company} onChange={(e) => setCompanyId(e.target.value)}>
            {(companies.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {settings.data && <SettingsForm key={company} companyId={company} initial={settings.data} />}
    </section>
  );
}

function SettingsForm({ companyId, initial }: { companyId: string; initial: Settings }) {
  const client = useQueryClient();
  const [v, setV] = useState({
    pfEnabled: initial.pfEnabled,
    esiEnabled: initial.esiEnabled,
    labourCodeWages: initial.labourCodeWages,
    pfEstablishmentId: initial.pfEstablishmentId ?? '',
    esiEmployerCode: initial.esiEmployerCode ?? '',
    tan: initial.tan ?? '',
  });
  const [saved, setSaved] = useState(false);
  const m = useMutation({
    mutationFn: () => apiFetch(`/v1/payroll/settings/${companyId}`, { method: 'PUT', body: v }),
    onSuccess: async () => {
      setSaved(true);
      await client.invalidateQueries({ queryKey: payrollKeys.settings(companyId) });
    },
  });
  if (!initial.statutory)
    return (
      <Alert tone="info">
        Indian statutory deductions apply only to companies in India on a plan that includes them.
      </Alert>
    );
  return (
    <form
      className="flex max-w-xl flex-col gap-3 rounded-lg border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        m.mutate();
      }}
    >
      {m.isError && <Alert tone="error">{errorMessage(m.error)}</Alert>}
      {saved && <Alert tone="success">Saved.</Alert>}
      {(
        [
          ['pfEnabled', 'Provident fund'],
          ['esiEnabled', 'ESI'],
          [
            'labourCodeWages',
            'Count allowances above half of pay as PF wages (labour codes, from 21 November 2025)',
          ],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={v[key]}
            onChange={(e) => setV((x) => ({ ...x, [key]: e.target.checked }))}
          />
          {label}
        </label>
      ))}
      <Field id="st-pf" label="PF establishment ID">
        <Input
          id="st-pf"
          value={v.pfEstablishmentId}
          onChange={(e) => setV((x) => ({ ...x, pfEstablishmentId: e.target.value }))}
        />
      </Field>
      <Field id="st-esi" label="ESI employer code">
        <Input
          id="st-esi"
          value={v.esiEmployerCode}
          onChange={(e) => setV((x) => ({ ...x, esiEmployerCode: e.target.value }))}
        />
      </Field>
      <Field id="st-tan" label="TAN">
        <Input id="st-tan" value={v.tan} onChange={(e) => setV((x) => ({ ...x, tan: e.target.value }))} />
      </Field>
      <Button type="submit" className="self-start" disabled={m.isPending}>
        Save statutory settings
      </Button>
    </form>
  );
}

function ProfessionalTax() {
  const tables = useQuery({
    queryKey: payrollKeys.pt,
    queryFn: () =>
      apiFetch<
        {
          state: string;
          name: string;
          slabs: { upTo: number | null; amount: number; february?: number }[];
          custom: boolean;
        }[]
      >('/v1/payroll/professional-tax'),
  });
  return (
    <section aria-labelledby="pt-heading" className="flex flex-col gap-3">
      <h2 id="pt-heading" className="text-[17px] font-semibold">
        Professional tax
      </h2>
      <p className="text-[13px] text-muted-foreground">
        Starting tables for a few states. States revise these: check them against the current notification. An
        employee pays the tax of the state set on their payroll details.
      </p>
      {tables.data && (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {tables.data.map((t) => (
            <li key={t.state} className="rounded-lg border border-border bg-card p-4 text-sm">
              <p className="font-medium">
                {t.name} {t.custom && <Badge>Changed</Badge>}
              </p>
              <ul className="mt-1 text-[13px]">
                {t.slabs.map((s, i) => (
                  <li key={i}>
                    {s.upTo === null ? 'Above' : `Up to ${rupees(s.upTo)}`}: {rupees(s.amount)}
                    {s.february !== undefined && ` (${rupees(s.february)} in February)`}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
