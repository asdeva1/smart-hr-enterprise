'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ALL_LIMITS, DEPLOYMENT_MODELS, FEATURES, LIMITS, SUPPORT_LEVELS } from '@smart-hr/entitlements';
import { createPlanSchema, type CreatePlanInput } from '@smart-hr/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { applyFieldErrors, errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import {
  formatDate,
  formatLimit,
  planKeys,
  usePlans,
  type Plan,
  type PlanPrice,
  type PlanVersion,
} from '@/lib/plan';

type Notice = { tone: 'success' | 'error'; text: string };

const VERSION_TONE = { DRAFT: 'warning', PUBLISHED: 'success', RETIRED: 'neutral' } as const;

export function PlansAdmin() {
  const plans = usePlans();
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<Notice>();

  if (plans.isPending) return <Loading />;
  if (plans.isError) return <Alert tone="error">{errorMessage(plans.error)}</Alert>;
  const current = plans.data.find((p) => p.id === selected) ?? plans.data[0];

  return (
    <>
      <PageHeader
        title="Plan catalogue"
        description="Plans, their versions and prices. Publishing freezes a version, so customers keep the terms they bought; changes go into a new version."
        actions={<Button onClick={() => setCreating(true)}>New plan</Button>}
      />
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {plans.data.length === 0 ? (
        <EmptyState title="No plans yet">
          Create a plan, or run the catalogue sync to load the starting plans.
        </EmptyState>
      ) : (
        <div className="flex flex-wrap gap-6">
          <nav
            aria-label="Plans"
            className="flex flex-[1_1_220px] flex-col gap-1.5 min-[900px]:max-w-[260px]"
          >
            {plans.data.map((p) => {
              const live = p.versions.find((v) => v.status === 'PUBLISHED');
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-current={p.id === current?.id ? 'true' : undefined}
                  onClick={() => setSelected(p.id)}
                  className={`flex flex-col items-start rounded-lg border px-4 py-3 text-left ${
                    p.id === current?.id
                      ? 'border-primary bg-primary-soft'
                      : 'border-border bg-card hover:bg-muted'
                  }`}
                >
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.code} · {live ? `v${live.version} live` : 'not published'}
                  </span>
                </button>
              );
            })}
          </nav>
          {current && <PlanDetail key={current.id} plan={current} onNotice={setNotice} />}
        </div>
      )}
      {creating && (
        <CreatePlanDialog
          onClose={() => setCreating(false)}
          onCreated={(plan) => {
            setCreating(false);
            setSelected(plan.id);
            setNotice({ tone: 'success', text: `${plan.name} created with an empty draft.` });
          }}
        />
      )}
    </>
  );
}

function PlanDetail({ plan, onNotice }: { plan: Plan; onNotice: (n: Notice) => void }) {
  const client = useQueryClient();
  const [versionId, setVersionId] = useState(plan.versions[0]?.id);
  const version = plan.versions.find((v) => v.id === versionId) ?? plan.versions[0];
  const refresh = () => client.invalidateQueries({ queryKey: planKeys.plans });

  const act = useMutation({
    mutationFn: ({ path, method }: { path: string; method: string; done: string }) =>
      apiFetch<PlanVersion | undefined>(path, { method }),
    onSuccess: async (result, vars) => {
      if (result && 'id' in result) setVersionId(result.id);
      onNotice({ tone: 'success', text: vars.done });
      await refresh();
    },
    onError: (e) => onNotice({ tone: 'error', text: errorMessage(e) }),
  });

  const hasDraft = plan.versions.some((v) => v.status === 'DRAFT');

  return (
    <section aria-label={plan.name} className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-xl font-semibold">{plan.name}</h2>
          {plan.description && <p className="text-[13px] text-muted-foreground">{plan.description}</p>}
        </div>
        {!hasDraft && (
          <Button
            variant="outline"
            disabled={act.isPending}
            onClick={() =>
              act.mutate({
                path: `/v1/platform/plans/${plan.id}/versions`,
                method: 'POST',
                done: 'New draft created from the latest version.',
              })
            }
          >
            New draft version
          </Button>
        )}
      </div>

      <Table label={`${plan.name} versions`}>
        <thead>
          <tr>
            <Th>Version</Th>
            <Th>Status</Th>
            <Th>Published</Th>
            <Th className="text-right">Organisations</Th>
            <Th>
              <span className="sr-only">Select</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {plan.versions.map((v) => (
            <tr key={v.id} className={v.id === version?.id ? 'bg-primary-soft/40' : undefined}>
              <Td className="font-medium">v{v.version}</Td>
              <Td>
                <Badge tone={VERSION_TONE[v.status]}>
                  {v.status.charAt(0) + v.status.slice(1).toLowerCase()}
                </Badge>
              </Td>
              <Td>{formatDate(v.publishedAt)}</Td>
              <Td className="text-right tabular-nums">{v._count.subscriptions}</Td>
              <Td className="text-right">
                <Button variant="ghost" size="sm" onClick={() => setVersionId(v.id)}>
                  {v.status === 'DRAFT' ? 'Edit' : 'View'}
                  <span className="sr-only"> version {v.version}</span>
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      {version &&
        (version.status === 'DRAFT' ? (
          <DraftEditor
            key={version.id}
            version={version}
            busy={act.isPending}
            onSaved={async () => {
              onNotice({ tone: 'success', text: `Draft v${version.version} saved.` });
              await refresh();
            }}
            onError={(text) => onNotice({ tone: 'error', text })}
            onPublish={() =>
              act.mutate({
                path: `/v1/platform/plan-versions/${version.id}/publish`,
                method: 'POST',
                done: `v${version.version} published. It can no longer be changed.`,
              })
            }
            onDelete={() =>
              act.mutate({
                path: `/v1/platform/plan-versions/${version.id}`,
                method: 'DELETE',
                done: `Draft v${version.version} deleted.`,
              })
            }
          />
        ) : (
          <VersionView
            version={version}
            busy={act.isPending}
            onRetire={() =>
              act.mutate({
                path: `/v1/platform/plan-versions/${version.id}/retire`,
                method: 'POST',
                done: `v${version.version} retired. Organisations on it keep it until moved.`,
              })
            }
          />
        ))}
    </section>
  );
}

const MODULES = (() => {
  const map = new Map<string, { code: string; label: string }[]>();
  for (const [code, def] of Object.entries(FEATURES)) {
    map.set(def.module, [...(map.get(def.module) ?? []), { code, label: def.label }]);
  }
  return [...map.entries()];
})();

function priceLabel(p: PlanPrice) {
  const model = { PER_USER: 'per member', PER_EMPLOYEE: 'per employee', FLAT: 'flat' }[p.pricingModel];
  return `${p.currency} ${Number(p.amount).toLocaleString('en-IN', { maximumFractionDigits: 4 })} ${
    p.billingPeriod === 'ANNUAL' ? '/ year' : '/ month'
  } ${model}`;
}

function VersionView({
  version,
  busy,
  onRetire,
}: {
  version: PlanVersion;
  busy: boolean;
  onRetire: () => void;
}) {
  const included = new Set(version.features);
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">
          Version {version.version} {version.status === 'RETIRED' ? '(retired)' : '(published, frozen)'}
        </h3>
        {version.status === 'PUBLISHED' && (
          <Button variant="danger" size="sm" disabled={busy} onClick={onRetire}>
            Retire version
          </Button>
        )}
      </div>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Trial</dt>
          <dd>{version.trialDays ? `${version.trialDays} days` : 'None'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Grace after lapse</dt>
          <dd>{version.graceDays} days</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Support</dt>
          <dd>{version.supportLevel}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Deployment</dt>
          <dd>{version.deploymentModels.join(', ')}</dd>
        </div>
      </dl>
      <div>
        <h4 className="mb-1 text-[13px] font-semibold">Prices</h4>
        {version.prices.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No list price (quoted per contract).</p>
        ) : (
          <ul className="text-[13px]">
            {version.prices.map((p) => (
              <li key={p.id}>{priceLabel(p)}</li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4 className="mb-1 text-[13px] font-semibold">Limits</h4>
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-1 text-[13px]">
          {ALL_LIMITS.map((key) => (
            <li key={key}>
              {LIMITS[key].label}: {formatLimit(version.limits[key] ?? null, LIMITS[key].unit)}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="mb-1 text-[13px] font-semibold">Features ({version.features.length})</h4>
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-1 text-[13px]">
          {Object.entries(FEATURES)
            .filter(([code]) => included.has(code))
            .map(([code, def]) => (
              <li key={code}>
                <span className="text-muted-foreground">{def.module}:</span> {def.label}
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

interface DraftState {
  features: Set<string>;
  limits: Record<string, string>;
  unlimited: Record<string, boolean>;
  trialDays: string;
  graceDays: string;
  supportLevel: string;
  deploymentModels: Set<string>;
  prices: { currency: string; billingPeriod: string; pricingModel: string; amount: string }[];
}

function DraftEditor({
  version,
  busy,
  onSaved,
  onError,
  onPublish,
  onDelete,
}: {
  version: PlanVersion;
  busy: boolean;
  onSaved: () => Promise<void>;
  onError: (text: string) => void;
  onPublish: () => void;
  onDelete: () => void;
}) {
  const [state, setState] = useState<DraftState>(() => ({
    features: new Set(version.features),
    limits: Object.fromEntries(ALL_LIMITS.map((k) => [k, String(version.limits[k] ?? '')])),
    unlimited: Object.fromEntries(ALL_LIMITS.map((k) => [k, (version.limits[k] ?? null) === null])),
    trialDays: String(version.trialDays),
    graceDays: String(version.graceDays),
    supportLevel: version.supportLevel,
    deploymentModels: new Set(version.deploymentModels),
    prices: version.prices.map((p) => ({ ...p, amount: String(p.amount) })),
  }));
  const [dirty, setDirty] = useState(false);
  const update = (patch: Partial<DraftState>) => {
    setState((s) => ({ ...s, ...patch }));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () =>
      apiFetch<PlanVersion>(`/v1/platform/plan-versions/${version.id}`, {
        method: 'PATCH',
        body: {
          features: [...state.features],
          limits: Object.fromEntries(
            ALL_LIMITS.map((k) => [k, state.unlimited[k] ? null : Number(state.limits[k] || 0)]),
          ),
          trialDays: Number(state.trialDays),
          graceDays: Number(state.graceDays),
          supportLevel: state.supportLevel,
          deploymentModels: [...state.deploymentModels],
          prices: state.prices,
        },
      }),
    onSuccess: async () => {
      setDirty(false);
      await onSaved();
    },
    onError: (e) => onError(errorMessage(e)),
  });

  const toggle = (set: Set<string>, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  return (
    <form
      className="flex flex-col gap-5 rounded-lg border border-warning/40 bg-card p-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">Draft version {version.version}</h3>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="danger" size="sm" disabled={busy} onClick={onDelete}>
            Delete draft
          </Button>
          <Button type="submit" variant="outline" size="sm" disabled={save.isPending || !dirty}>
            Save draft
          </Button>
          <Button type="button" size="sm" disabled={busy || dirty} onClick={onPublish}>
            Publish
          </Button>
        </div>
      </div>
      {dirty && <p className="text-[13px] text-warning">Save the draft before publishing.</p>}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
        <Field id="trial-days" label="Trial days">
          <Input
            id="trial-days"
            type="number"
            min={0}
            max={365}
            value={state.trialDays}
            onChange={(e) => update({ trialDays: e.target.value })}
          />
        </Field>
        <Field id="grace-days" label="Grace days after lapse">
          <Input
            id="grace-days"
            type="number"
            min={0}
            max={365}
            value={state.graceDays}
            onChange={(e) => update({ graceDays: e.target.value })}
          />
        </Field>
        <Field id="support-level" label="Support level">
          <Select
            id="support-level"
            value={state.supportLevel}
            onChange={(e) => update({ supportLevel: e.target.value })}
          >
            {SUPPORT_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l.charAt(0) + l.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-semibold">Deployment models</legend>
        <div className="flex flex-wrap gap-4 text-[13px]">
          {DEPLOYMENT_MODELS.map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={state.deploymentModels.has(m)}
                onChange={() => update({ deploymentModels: toggle(state.deploymentModels, m) })}
              />
              {{ SAAS: 'Multi-tenant SaaS', DEDICATED: 'Dedicated managed', IN_HOUSE: 'In-house' }[m]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-semibold">Limits</legend>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
          {ALL_LIMITS.map((k) => (
            <div key={k} className="flex flex-col gap-1.5">
              <label htmlFor={`limit-${k}`} className="text-[13px] font-medium">
                {LIMITS[k].label} ({LIMITS[k].unit})
              </label>
              <Input
                id={`limit-${k}`}
                type="number"
                min={0}
                disabled={state.unlimited[k]}
                value={state.unlimited[k] ? '' : state.limits[k]}
                onChange={(e) => update({ limits: { ...state.limits, [k]: e.target.value } })}
              />
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={state.unlimited[k]}
                  onChange={(e) => update({ unlimited: { ...state.unlimited, [k]: e.target.checked } })}
                />
                Unlimited
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-semibold">Prices</legend>
        {state.prices.length === 0 && (
          <p className="text-[13px] text-muted-foreground">
            No list price. Add one, or leave empty for contract pricing.
          </p>
        )}
        {state.prices.map((p, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <Field id={`price-currency-${i}`} label="Currency">
              <Input
                id={`price-currency-${i}`}
                className="w-24 uppercase"
                maxLength={3}
                value={p.currency}
                onChange={(e) => {
                  const prices = [...state.prices];
                  prices[i] = { ...p, currency: e.target.value.toUpperCase() };
                  update({ prices });
                }}
              />
            </Field>
            <Field id={`price-period-${i}`} label="Billing">
              <Select
                id={`price-period-${i}`}
                value={p.billingPeriod}
                onChange={(e) => {
                  const prices = [...state.prices];
                  prices[i] = { ...p, billingPeriod: e.target.value };
                  update({ prices });
                }}
              >
                <option value="MONTHLY">Monthly</option>
                <option value="ANNUAL">Annual</option>
              </Select>
            </Field>
            <Field id={`price-model-${i}`} label="Charged">
              <Select
                id={`price-model-${i}`}
                value={p.pricingModel}
                onChange={(e) => {
                  const prices = [...state.prices];
                  prices[i] = { ...p, pricingModel: e.target.value };
                  update({ prices });
                }}
              >
                <option value="PER_EMPLOYEE">Per employee</option>
                <option value="PER_USER">Per member</option>
                <option value="FLAT">Flat</option>
              </Select>
            </Field>
            <Field id={`price-amount-${i}`} label="Amount">
              <Input
                id={`price-amount-${i}`}
                inputMode="decimal"
                className="w-36"
                value={p.amount}
                onChange={(e) => {
                  const prices = [...state.prices];
                  prices[i] = { ...p, amount: e.target.value };
                  update({ prices });
                }}
              />
            </Field>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => update({ prices: state.prices.filter((_, j) => j !== i) })}
            >
              Remove<span className="sr-only"> price {i + 1}</span>
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              update({
                prices: [
                  ...state.prices,
                  { currency: 'INR', billingPeriod: 'MONTHLY', pricingModel: 'PER_EMPLOYEE', amount: '' },
                ],
              })
            }
          >
            Add price
          </Button>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-[13px] font-semibold">Features ({state.features.size})</legend>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
          {MODULES.map(([module, list]) => (
            <div key={module} className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold">{module}</span>
              {list.map((f) => (
                <label key={f.code} className="flex items-start gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={state.features.has(f.code)}
                    onChange={() => update({ features: toggle(state.features, f.code) })}
                  />
                  {f.label}
                </label>
              ))}
            </div>
          ))}
        </div>
      </fieldset>
    </form>
  );
}

function CreatePlanDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (plan: Plan) => void }) {
  const client = useQueryClient();
  const [error, setError] = useState<string>();
  const form = useForm<CreatePlanInput>({
    resolver: zodResolver(createPlanSchema),
    defaultValues: { code: '', name: '', description: '', sortOrder: 100 },
  });
  const create = useMutation({
    mutationFn: (v: CreatePlanInput) => apiFetch<Plan>('/v1/platform/plans', { method: 'POST', body: v }),
    onSuccess: async (plan) => {
      await client.invalidateQueries({ queryKey: planKeys.plans });
      onCreated(plan);
    },
    onError: (e) => {
      if (!applyFieldErrors(e, form.setError)) setError(errorMessage(e));
    },
  });
  const errors = form.formState.errors;
  return (
    <Dialog
      open
      onClose={onClose}
      title="New plan"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-plan" disabled={create.isPending}>
            Create plan
          </Button>
        </>
      }
    >
      <form
        id="new-plan"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((v) => {
          setError(undefined);
          create.mutate(v);
        })}
      >
        {error && <Alert tone="error">{error}</Alert>}
        <Field id="plan-code" label="Code" error={errors.code?.message} hint="Stable identifier, e.g. GROWTH">
          <Input
            {...fieldAria('plan-code', errors.code?.message, 'hint')}
            className="font-mono uppercase"
            {...form.register('code')}
          />
        </Field>
        <Field id="plan-name" label="Name" error={errors.name?.message}>
          <Input {...fieldAria('plan-name', errors.name?.message)} {...form.register('name')} />
        </Field>
        <Field id="plan-description" label="Description (optional)" error={errors.description?.message}>
          <Input
            {...fieldAria('plan-description', errors.description?.message)}
            {...form.register('description')}
          />
        </Field>
      </form>
    </Dialog>
  );
}
