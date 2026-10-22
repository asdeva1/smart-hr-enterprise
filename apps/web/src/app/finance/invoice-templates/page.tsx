'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { can } from '@/lib/permissions';
import { salesKeys, useTemplates, type Template } from '@/lib/sales';
import { cn } from '@/lib/utils';
import { FinancePage, SalesTabs } from '../finance-page';

const LAYOUT_NOTE: Record<Template['layout'], string> = {
  CLASSIC: 'Logo left, full GST breakup. Works for most businesses.',
  MODERN: 'Bold header band and generous spacing.',
  MINIMAL: 'Plain lines, no colour. Good for printing.',
  COMPACT_GST: 'Tight rows for long invoices.',
};
const COLOURS = ['#1d56c9', '#0f6b5c', '#7a2e8e', '#b4531a', '#33424e'];
const FLAGS = [
  ['showHsn', 'HSN/SAC code column'],
  ['showGstSplit', 'CGST, SGST and IGST breakup'],
  ['showBank', 'Bank details'],
  ['showUpi', 'UPI ID'],
  ['showSignatory', 'Authorised signatory'],
  ['showPo', 'Customer PO number'],
] as const;

export default function TemplatesPage() {
  return (
    <FinancePage active="Invoice templates">
      {(session) => <Templates canManage={can(session, 'finance.manage')} />}
    </FinancePage>
  );
}

function Templates({ canManage }: { canManage: boolean }) {
  const templates = useTemplates();
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const list = (templates.data ?? []).filter((t) => t.status === 'ACTIVE');
  const current = list.find((t) => t.id === selected) ?? list.find((t) => t.isDefault) ?? list[0];
  return (
    <>
      <PageHeader
        title="Invoice templates"
        description="Choose how your documents look. The default is used for every new one."
        actions={canManage ? <Button onClick={() => setAdding(true)}>New template</Button> : null}
      />
      <SalesTabs active="/finance/invoice-templates" />
      {templates.isPending ? (
        <Loading />
      ) : templates.isError ? (
        <Alert tone="error">{errorMessage(templates.error)}</Alert>
      ) : (
        <div className="flex flex-wrap items-start gap-6">
          <section aria-label="Templates" className="grid min-w-0 flex-[2_1_520px] gap-4 sm:grid-cols-2">
            {list.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={current?.id === t.id}
                onClick={() => setSelected(t.id)}
                className={cn(
                  'flex flex-col gap-3 rounded-lg border-2 bg-card p-3.5 text-left',
                  current?.id === t.id ? 'border-primary' : 'border-border',
                )}
              >
                <Thumb t={t} />
                <div className="flex items-center gap-2">
                  <span className="flex-1 font-semibold">{t.name}</span>
                  {t.isDefault && <Badge tone="success">Default</Badge>}
                </div>
                <div className="text-[13px] text-muted-foreground">{LAYOUT_NOTE[t.layout]}</div>
              </button>
            ))}
          </section>
          {current && <Settings key={current.id} t={current} canManage={canManage} />}
        </div>
      )}
      {adding && <NewTemplate onClose={() => setAdding(false)} />}
    </>
  );
}

function Thumb({ t }: { t: Template }) {
  const bar = 'h-1.5 rounded bg-[#dde3e8]';
  return (
    <div className="flex h-44 flex-col gap-2 overflow-hidden rounded border border-border bg-[#fbfcfd] p-3.5">
      <div className="flex items-center justify-between">
        <div className="size-6 rounded" style={{ background: t.accent }} />
        <div className="h-2 w-16 rounded" style={{ background: t.accent }} />
      </div>
      <div className="h-1.5 w-2/5 rounded bg-[#c9d3da]" />
      <div className="mt-1 h-3.5 rounded-sm" style={{ background: `${t.accent}22` }} />
      <div className={bar} />
      <div className={bar} />
      <div className={cn(bar, 'w-5/6')} />
      <div className="mt-auto h-3 w-20 self-end rounded" style={{ background: t.accent }} />
    </div>
  );
}

function Settings({ t, canManage }: { t: Template; canManage: boolean }) {
  const client = useQueryClient();
  const [f, setF] = useState({
    accent: t.accent,
    showHsn: t.showHsn,
    showGstSplit: t.showGstSplit,
    showBank: t.showBank,
    showUpi: t.showUpi,
    showSignatory: t.showSignatory,
    showPo: t.showPo,
    defaultTerms: t.defaultTerms ?? '',
    defaultNote: t.defaultNote ?? '',
  });
  const refresh = () => client.invalidateQueries({ queryKey: salesKeys.templates });
  const save = useMutation({
    mutationFn: () => apiFetch(`/v1/finance/sales/templates/${t.id}`, { method: 'PUT', body: f }),
    onSuccess: refresh,
  });
  const makeDefault = useMutation({
    mutationFn: () => apiFetch(`/v1/finance/sales/templates/${t.id}/default`, { method: 'POST' }),
    onSuccess: refresh,
  });
  const archive = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/finance/sales/templates/${t.id}`, { method: 'PUT', body: { status: 'ARCHIVED' } }),
    onSuccess: refresh,
  });
  const err = save.error ?? makeDefault.error ?? archive.error;
  return (
    <aside
      aria-labelledby="tpl-settings"
      className="flex min-w-0 max-w-[420px] flex-[1_1_320px] flex-col gap-4 rounded-lg border border-border bg-card p-5"
    >
      <h2 id="tpl-settings" className="text-base font-semibold">
        {t.name} settings
      </h2>
      {err && <Alert tone="error">{errorMessage(err)}</Alert>}
      <fieldset className="flex flex-col gap-2" disabled={!canManage}>
        <legend className="mb-1.5 text-[13px] font-medium">Accent colour</legend>
        <div className="flex gap-2">
          {COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Use colour ${c}`}
              aria-pressed={f.accent === c}
              onClick={() => setF((s) => ({ ...s, accent: c }))}
              className={cn(
                'size-7 rounded-full',
                f.accent === c && 'outline-2 outline-offset-2 outline-foreground',
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2" disabled={!canManage}>
        <legend className="mb-1.5 text-[13px] font-medium">Show on the document</legend>
        {FLAGS.map(([k, label]) => (
          <label key={k} className="flex min-h-9 items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="size-[18px]"
              checked={f[k]}
              onChange={(e) => setF((s) => ({ ...s, [k]: e.target.checked }))}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <Field id="tpl-note" label="Default note">
        <textarea
          id="tpl-note"
          rows={2}
          disabled={!canManage}
          className="rounded-md border border-input bg-card px-3 py-2"
          value={f.defaultNote}
          onChange={(e) => setF((s) => ({ ...s, defaultNote: e.target.value }))}
        />
      </Field>
      <Field id="tpl-terms" label="Default terms">
        <textarea
          id="tpl-terms"
          rows={3}
          disabled={!canManage}
          className="rounded-md border border-input bg-card px-3 py-2"
          value={f.defaultTerms}
          onChange={(e) => setF((s) => ({ ...s, defaultTerms: e.target.value }))}
        />
      </Field>
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Save changes
          </Button>
          {!t.isDefault && (
            <>
              <Button variant="outline" disabled={makeDefault.isPending} onClick={() => makeDefault.mutate()}>
                Make default
              </Button>
              <Button variant="danger" disabled={archive.isPending} onClick={() => archive.mutate()}>
                Archive
              </Button>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

function NewTemplate({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [layout, setLayout] = useState<Template['layout']>('CLASSIC');
  const create = useMutation({
    mutationFn: () => apiFetch('/v1/finance/sales/templates', { method: 'POST', body: { name, layout } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: salesKeys.templates });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="New template"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={create.isPending || !name.trim()} onClick={() => create.mutate()}>
            Create
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {create.isError && <Alert tone="error">{errorMessage(create.error)}</Alert>}
        <Field id="nt-name" label="Name">
          <Input id="nt-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="nt-layout" label="Layout">
          <select
            id="nt-layout"
            className="h-11 w-full rounded-md border border-input bg-card px-3"
            value={layout}
            onChange={(e) => setLayout(e.target.value as Template['layout'])}
          >
            {(Object.keys(LAYOUT_NOTE) as Template['layout'][]).map((l) => (
              <option key={l} value={l}>
                {l === 'COMPACT_GST' ? 'Compact GST' : l.charAt(0) + l.slice(1).toLowerCase()} —{' '}
                {LAYOUT_NOTE[l]}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Dialog>
  );
}
