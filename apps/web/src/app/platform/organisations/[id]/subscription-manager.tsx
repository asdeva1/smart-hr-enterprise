'use client';

import { FEATURES, LIMITS } from '@smart-hr/entitlements';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import {
  formatDate,
  formatLimit,
  planKeys,
  STATUS_LABEL,
  STATUS_TONE,
  useAddons,
  usePlans,
  useTenantSubscription,
} from '@/lib/plan';

type Notice = { tone: 'success' | 'error'; text: string };

/** End of a date input's day in the browser's time zone, as an ISO instant. */
function endOfDay(date: string): string {
  return new Date(`${date}T23:59:59`).toISOString();
}

export function SubscriptionManager({ tenantId }: { tenantId: string }) {
  const client = useQueryClient();
  const detail = useTenantSubscription(tenantId);
  const [notice, setNotice] = useState<Notice>();
  const refresh = async (text: string) => {
    setNotice({ tone: 'success', text });
    await client.invalidateQueries({ queryKey: planKeys.subscription(tenantId) });
    await client.invalidateQueries({ queryKey: planKeys.tenants });
  };
  const onError = (e: unknown) => setNotice({ tone: 'error', text: errorMessage(e) });

  if (detail.isPending) return <Loading />;
  if (detail.isError) return <Alert tone="error">{errorMessage(detail.error)}</Alert>;
  const { subscription: sub, overrides, events, entitlements: e, usage } = detail.data;
  const base = `/v1/platform/tenants/${tenantId}`;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground">
          {e.plan
            ? `${e.plan.name} v${e.plan.version} · ${e.features.length} features`
            : 'No subscription yet'}
        </p>
        <Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
      </div>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <div className="grid gap-4 min-[1000px]:grid-cols-2">
        <AssignPlan
          tenantId={tenantId}
          current={sub?.planVersionId}
          onDone={(t) => void refresh(t)}
          onError={onError}
        />
        {sub && <Lifecycle base={base} sub={sub} onDone={(t) => void refresh(t)} onError={onError} />}
      </div>

      <section aria-labelledby="usage-heading" className="rounded-lg border border-border bg-card p-5">
        <h2 id="usage-heading" className="mb-3 font-semibold">
          Limits and usage
        </h2>
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2 text-[13px]">
          {Object.entries(LIMITS).map(([code, def]) => (
            <li key={code}>
              <span className="text-muted-foreground">{def.label}:</span>{' '}
              {usage[code] !== undefined ? `${usage[code]} of ` : ''}
              {formatLimit(e.limits[code] ?? null, def.unit)}
            </li>
          ))}
        </ul>
      </section>

      {sub && <Addons base={base} current={sub.addons} onDone={(t) => void refresh(t)} onError={onError} />}
      <Overrides base={base} overrides={overrides} onDone={(t) => void refresh(t)} onError={onError} />

      <section aria-labelledby="history-heading" className="flex flex-col gap-2">
        <h2 id="history-heading" className="font-semibold">
          Subscription history
        </h2>
        <Table label="Subscription history">
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Change</Th>
              <Th>Status</Th>
              <Th>Details</Th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr key={ev.id}>
                <Td className="whitespace-nowrap">{new Date(ev.occurredAt).toLocaleString('en-IN')}</Td>
                <Td>{ev.action.replace('_', ' ')}</Td>
                <Td className="text-[13px]">
                  {ev.fromStatus ? `${ev.fromStatus} → ` : ''}
                  {ev.toStatus ?? '—'}
                </Td>
                <Td className="text-[13px] text-muted-foreground">
                  {typeof ev.details.reason === 'string' ? ev.details.reason : ''}
                </Td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <Td colSpan={4} className="text-muted-foreground">
                  No changes yet.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </section>
    </>
  );
}

function AssignPlan({
  tenantId,
  current,
  onDone,
  onError,
}: {
  tenantId: string;
  current: string | undefined;
  onDone: (text: string) => void;
  onError: (e: unknown) => void;
}) {
  const plans = usePlans();
  const [versionId, setVersionId] = useState('');
  const [status, setStatus] = useState<'TRIAL' | 'ACTIVE'>('ACTIVE');
  const [periodEnd, setPeriodEnd] = useState('');
  const [billingPeriod, setBillingPeriod] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY');
  const [currency, setCurrency] = useState('INR');
  const [licensed, setLicensed] = useState('');
  const [reason, setReason] = useState('');
  const assign = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/platform/tenants/${tenantId}/subscription`, {
        method: 'PUT',
        body: {
          planVersionId: versionId,
          status,
          billingPeriod,
          currency,
          ...(licensed ? { licensedEmployees: Number(licensed) } : {}),
          ...(status === 'ACTIVE' && periodEnd ? { currentPeriodEnd: endOfDay(periodEnd) } : {}),
          ...(reason ? { reason } : {}),
        },
      }),
    onSuccess: () => onDone(current ? 'Plan changed.' : 'Subscription started.'),
    onError,
  });
  const options = (plans.data ?? []).flatMap((p) =>
    p.versions
      .filter((v) => v.status === 'PUBLISHED')
      .map((v) => ({
        id: v.id,
        label: `${p.name} v${v.version}${v.trialDays ? ` (${v.trialDays}-day trial)` : ''}`,
      })),
  );
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5"
      onSubmit={(ev) => {
        ev.preventDefault();
        assign.mutate();
      }}
    >
      <h2 className="font-semibold">{current ? 'Change plan' : 'Start a subscription'}</h2>
      <Field id="assign-version" label="Plan version">
        <Select
          id="assign-version"
          required
          value={versionId}
          onChange={(ev) => setVersionId(ev.target.value)}
        >
          <option value="">Choose a published version</option>
          {options.map((o) => (
            <option key={o.id} value={o.id} disabled={o.id === current}>
              {o.label}
              {o.id === current ? ' — current' : ''}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="assign-status" label="Start as">
          <Select
            id="assign-status"
            value={status}
            onChange={(ev) => setStatus(ev.target.value as 'TRIAL' | 'ACTIVE')}
          >
            <option value="ACTIVE">Active</option>
            <option value="TRIAL">Trial</option>
          </Select>
        </Field>
        <Field id="assign-billing" label="Billing">
          <Select
            id="assign-billing"
            value={billingPeriod}
            onChange={(ev) => setBillingPeriod(ev.target.value as 'MONTHLY' | 'ANNUAL')}
          >
            <option value="MONTHLY">Monthly</option>
            <option value="ANNUAL">Annual</option>
          </Select>
        </Field>
        <Field id="assign-currency" label="Currency">
          <Input
            id="assign-currency"
            maxLength={3}
            className="uppercase"
            value={currency}
            onChange={(ev) => setCurrency(ev.target.value.toUpperCase())}
          />
        </Field>
        <Field
          id="assign-licensed"
          label="Licensed employees"
          hint="Employees bought. Empty = the plan's own limit"
        >
          <Input
            id="assign-licensed"
            type="number"
            min={1}
            value={licensed}
            onChange={(ev) => setLicensed(ev.target.value)}
          />
        </Field>
        {status === 'ACTIVE' && (
          <Field id="assign-period-end" label="Period ends (optional)" hint="Leave empty for open-ended">
            <Input
              id="assign-period-end"
              type="date"
              value={periodEnd}
              onChange={(ev) => setPeriodEnd(ev.target.value)}
            />
          </Field>
        )}
      </div>
      <Field id="assign-reason" label="Reason (recorded in history)">
        <Input id="assign-reason" value={reason} onChange={(ev) => setReason(ev.target.value)} />
      </Field>
      <div>
        <Button type="submit" disabled={!versionId || assign.isPending}>
          {current ? 'Change plan' : 'Start subscription'}
        </Button>
      </div>
    </form>
  );
}

function Lifecycle({
  base,
  sub,
  onDone,
  onError,
}: {
  base: string;
  sub: NonNullable<ReturnType<typeof useTenantSubscription>['data']>['subscription'] & object;
  onDone: (text: string) => void;
  onError: (e: unknown) => void;
}) {
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`${base}/subscription/actions`, { method: 'POST', body }),
    onSuccess: (_r, body) => {
      setReason('');
      onDone(
        {
          renew: 'Renewed.',
          mark_past_due: 'Marked as past due.',
          suspend: 'Suspended. The organisation is read-only.',
          reactivate: 'Reactivated.',
          cancel: 'Cancelled. Access continues to the end of the period.',
        }[String(body.action)] ?? 'Done.',
      );
    },
    onError,
  });
  const withReason = reason ? { reason } : {};
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
      <h2 className="font-semibold">Billing lifecycle</h2>
      <dl className="grid grid-cols-2 gap-2 text-[13px]">
        <dt className="text-muted-foreground">Stored status</dt>
        <dd>{sub.status}</dd>
        <dt className="text-muted-foreground">Trial ends</dt>
        <dd>{formatDate(sub.trialEndsAt)}</dd>
        <dt className="text-muted-foreground">Period</dt>
        <dd>
          {formatDate(sub.currentPeriodStart)} →{' '}
          {sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : 'open'}
        </dd>
        <dt className="text-muted-foreground">Grace until</dt>
        <dd>{formatDate(sub.graceEndsAt)}</dd>
      </dl>
      <div className="grid grid-cols-2 gap-3">
        <Field id="life-date" label="Date" hint="New period end, or grace deadline">
          <Input id="life-date" type="date" value={date} onChange={(ev) => setDate(ev.target.value)} />
        </Field>
        <Field id="life-reason" label="Reason for this change">
          <Input id="life-reason" value={reason} onChange={(ev) => setReason(ev.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!date || act.isPending}
          onClick={() => act.mutate({ action: 'renew', currentPeriodEnd: endOfDay(date), ...withReason })}
        >
          Renew to date
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!date || act.isPending}
          onClick={() => act.mutate({ action: 'mark_past_due', graceEndsAt: endOfDay(date), ...withReason })}
        >
          Mark past due
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={act.isPending}
          onClick={() => act.mutate({ action: 'reactivate', ...withReason })}
        >
          Reactivate
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={reason.length < 3 || act.isPending}
          onClick={() => act.mutate({ action: 'suspend', reason })}
        >
          Suspend
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={act.isPending}
          onClick={() => act.mutate({ action: 'cancel', ...withReason })}
        >
          Cancel
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Suspending needs a reason. Suspended and ended organisations become read-only; their data is never
        deleted.
      </p>
    </div>
  );
}

function Addons({
  base,
  current,
  onDone,
  onError,
}: {
  base: string;
  current: { id: string; quantity: number; addon: { id: string; code: string; name: string } }[];
  onDone: (text: string) => void;
  onError: (e: unknown) => void;
}) {
  const addons = useAddons();
  const [addonId, setAddonId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const set = useMutation({
    mutationFn: (body: { addonId: string; quantity: number }) =>
      apiFetch(`${base}/subscription/addons`, { method: 'PUT', body }),
    onSuccess: (_r, body) => onDone(body.quantity === 0 ? 'Add-on removed.' : 'Add-on saved.'),
    onError,
  });
  return (
    <section
      aria-labelledby="addons-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5"
    >
      <h2 id="addons-heading" className="font-semibold">
        Add-ons
      </h2>
      {current.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">None.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-[13px]">
          {current.map((a) => (
            <li key={a.id} className="flex items-center gap-3">
              {a.addon.name} × {a.quantity}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => set.mutate({ addonId: a.addon.id, quantity: 0 })}
              >
                Remove<span className="sr-only"> {a.addon.name}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field id="addon-pick" label="Add-on">
          <Select id="addon-pick" value={addonId} onChange={(ev) => setAddonId(ev.target.value)}>
            <option value="">Choose…</option>
            {(addons.data ?? [])
              .filter((a) => a.status === 'ACTIVE')
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field id="addon-qty" label="Quantity">
          <Input
            id="addon-qty"
            type="number"
            min={1}
            className="w-24"
            value={quantity}
            onChange={(ev) => setQuantity(ev.target.value)}
          />
        </Field>
        <Button
          size="sm"
          disabled={!addonId || set.isPending}
          onClick={() => set.mutate({ addonId, quantity: Number(quantity) })}
        >
          Save add-on
        </Button>
      </div>
    </section>
  );
}

function Overrides({
  base,
  overrides,
  onDone,
  onError,
}: {
  base: string;
  overrides: NonNullable<ReturnType<typeof useTenantSubscription>['data']>['overrides'];
  onDone: (text: string) => void;
  onError: (e: unknown) => void;
}) {
  const [kind, setKind] = useState<'FEATURE' | 'LIMIT'>('FEATURE');
  const [key, setKey] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const create = useMutation({
    mutationFn: () =>
      apiFetch(`${base}/overrides`, {
        method: 'POST',
        body:
          kind === 'FEATURE'
            ? { kind, key, enabled, reason }
            : { kind, key, value: value === '' ? null : Number(value), reason },
      }),
    onSuccess: () => {
      setReason('');
      onDone('Override added. It applies immediately.');
    },
    onError,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`${base}/overrides/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => onDone('Override revoked.'),
    onError,
  });
  const keys = kind === 'FEATURE' ? Object.entries(FEATURES) : Object.entries(LIMITS);
  return (
    <section
      aria-labelledby="overrides-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5"
    >
      <h2 id="overrides-heading" className="font-semibold">
        Overrides
      </h2>
      <p className="text-[13px] text-muted-foreground">
        Exceptions for this organisation only, on top of its plan and add-ons. Every override needs a reason
        and is audited.
      </p>
      {overrides.length > 0 && (
        <Table label="Overrides">
          <thead>
            <tr>
              <Th>Override</Th>
              <Th>Reason</Th>
              <Th>Expires</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {overrides.map((o) => (
              <tr key={o.id} className={o.revokedAt ? 'opacity-60' : undefined}>
                <Td className="text-[13px]">
                  {o.kind === 'FEATURE'
                    ? `${o.enabled ? 'Grant' : 'Remove'} ${o.key}`
                    : `${o.key} = ${o.value ?? 'unlimited'}`}
                </Td>
                <Td className="text-[13px]">{o.reason}</Td>
                <Td className="text-[13px]">{o.revokedAt ? 'Revoked' : formatDate(o.expiresAt)}</Td>
                <Td className="text-right">
                  {!o.revokedAt && (
                    <Button size="sm" variant="ghost" onClick={() => revoke.mutate(o.id)}>
                      Revoke<span className="sr-only"> {o.key}</span>
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field id="ovr-kind" label="Type">
          <Select
            id="ovr-kind"
            value={kind}
            onChange={(ev) => {
              setKind(ev.target.value as 'FEATURE' | 'LIMIT');
              setKey('');
            }}
          >
            <option value="FEATURE">Feature</option>
            <option value="LIMIT">Limit</option>
          </Select>
        </Field>
        <Field id="ovr-key" label={kind === 'FEATURE' ? 'Feature' : 'Limit'}>
          <Select id="ovr-key" value={key} onChange={(ev) => setKey(ev.target.value)}>
            <option value="">Choose…</option>
            {keys.map(([code, def]) => (
              <option key={code} value={code}>
                {def.label}
              </option>
            ))}
          </Select>
        </Field>
        {kind === 'FEATURE' ? (
          <Field id="ovr-enabled" label="Effect">
            <Select
              id="ovr-enabled"
              value={String(enabled)}
              onChange={(ev) => setEnabled(ev.target.value === 'true')}
            >
              <option value="true">Grant</option>
              <option value="false">Remove</option>
            </Select>
          </Field>
        ) : (
          <Field id="ovr-value" label="Value" hint="Empty = unlimited">
            <Input
              id="ovr-value"
              type="number"
              min={0}
              value={value}
              onChange={(ev) => setValue(ev.target.value)}
            />
          </Field>
        )}
        <Field id="ovr-reason" label="Override reason">
          <Input id="ovr-reason" value={reason} onChange={(ev) => setReason(ev.target.value)} />
        </Field>
        <Button
          size="sm"
          disabled={!key || reason.length < 3 || create.isPending}
          onClick={() => create.mutate()}
        >
          Add override
        </Button>
      </div>
    </section>
  );
}
