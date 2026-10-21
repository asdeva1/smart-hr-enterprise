'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage, formatDateTime } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import {
  DELIVERY_TONE,
  EVENT_LABEL,
  SCOPE_LABEL,
  integrationKeys,
  type ApiKeyRow,
  type IntegrationOptions,
  type Webhook,
  type WebhookDelivery,
} from '@/lib/integrations';

type Shown = { title: string; what: string; value: string };

/** Webhooks (events sent out) and API keys (data read in) for the organisation's own systems. */
export function IntegrationsAdmin({ session }: { session: SessionView }) {
  const readOnly = session.activeTenant?.status === 'OFFBOARDING';
  const hasPlan = session.activeTenant?.plan.features.includes('integrations.custom') ?? false;
  const [shown, setShown] = useState<Shown>();
  const [notice, setNotice] = useState<string>();

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Send events to your own systems with webhooks, and let them read your employee directory with API keys."
      />
      {!hasPlan && (
        <Alert tone="info">
          Your plan doesn’t include integrations. Ask your administrator about upgrading.
        </Alert>
      )}
      {notice && <Alert tone="success">{notice}</Alert>}
      {hasPlan && (
        <>
          <Webhooks readOnly={readOnly} onSecret={setShown} onNotice={setNotice} />
          <ApiKeys readOnly={readOnly} onSecret={setShown} onNotice={setNotice} />
        </>
      )}
      {shown && <SecretDialog shown={shown} onClose={() => setShown(undefined)} />}
    </>
  );
}

/** A secret appears here once; after closing it can't be seen again. */
function SecretDialog({ shown, onClose }: { shown: Shown; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      title={shown.title}
      description={`Copy the ${shown.what} now. For safety it is shown only this once.`}
      footer={<Button onClick={onClose}>I’ve saved it</Button>}
    >
      <div className="flex flex-col gap-3">
        <code className="break-all rounded-md border border-border bg-muted px-3 py-2 text-[13px]">
          {shown.value}
        </code>
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard
              .writeText(shown.value)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </Dialog>
  );
}

function useOptions() {
  return useQuery({
    queryKey: integrationKeys.options,
    queryFn: () => apiFetch<IntegrationOptions>('/v1/integrations/options'),
  });
}

function Webhooks({
  readOnly,
  onSecret,
  onNotice,
}: {
  readOnly: boolean;
  onSecret: (s: Shown) => void;
  onNotice: (text: string) => void;
}) {
  const client = useQueryClient();
  const hooks = useQuery({
    queryKey: integrationKeys.webhooks,
    queryFn: () => apiFetch<Webhook[]>('/v1/integrations/webhooks'),
  });
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState<Webhook>();
  const [error, setError] = useState<string>();
  const refresh = () => client.invalidateQueries({ queryKey: integrationKeys.webhooks });
  const act = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <section className="flex flex-col gap-3" aria-labelledby="webhooks-h">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 id="webhooks-h" className="text-lg font-semibold">
            Webhooks
          </h2>
          <p className="text-[13px] text-muted-foreground">
            We send each event to your address, signed so you can check it came from us. Failed sends are
            retried for several hours.
          </p>
        </div>
        {!readOnly && <Button onClick={() => setCreating(true)}>Add a webhook</Button>}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {hooks.isPending ? (
        <Loading />
      ) : hooks.isError ? (
        <Alert tone="error">{errorMessage(hooks.error)}</Alert>
      ) : hooks.data.length === 0 ? (
        <EmptyState title="No webhooks yet">Add one to send events to your own systems.</EmptyState>
      ) : (
        <Table label="Webhooks">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Address</Th>
              <Th>Events</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {hooks.data.map((h) => (
              <tr key={h.id}>
                <Td>{h.name}</Td>
                <Td className="max-w-64 break-all">{h.url}</Td>
                <Td>{h.events.length}</Td>
                <Td>
                  {h.status === 'ACTIVE' ? (
                    <Badge tone="success">On</Badge>
                  ) : (
                    <Badge tone="danger">Off{h.failureStreak > 0 ? ' after failures' : ''}</Badge>
                  )}
                </Td>
                <Td>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setHistory(h)}>
                      Deliveries
                    </Button>
                    {!readOnly && (
                      <>
                        {h.status === 'ACTIVE' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={act.isPending}
                            onClick={() =>
                              act.mutate(async () => {
                                await apiFetch(`/v1/integrations/webhooks/${h.id}/test`, { method: 'POST' });
                                onNotice('A test event is queued. Check Deliveries in a minute.');
                                await client.invalidateQueries({
                                  queryKey: integrationKeys.deliveries(h.id),
                                });
                              })
                            }
                          >
                            Send test
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={act.isPending}
                          onClick={() =>
                            act.mutate(async () => {
                              const r = await apiFetch<{ secret: string }>(
                                `/v1/integrations/webhooks/${h.id}/rotate-secret`,
                                { method: 'POST' },
                              );
                              onSecret({ title: 'New signing secret', what: 'secret', value: r.secret });
                            })
                          }
                        >
                          New secret
                        </Button>
                        <Button
                          size="sm"
                          variant={h.status === 'ACTIVE' ? 'danger' : 'primary'}
                          disabled={act.isPending}
                          onClick={() =>
                            act.mutate(() =>
                              apiFetch(`/v1/integrations/webhooks/${h.id}`, {
                                method: 'PATCH',
                                body: { status: h.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' },
                              }),
                            )
                          }
                        >
                          {h.status === 'ACTIVE' ? 'Turn off' : 'Turn on'}
                        </Button>
                      </>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {creating && (
        <WebhookDialog
          onClose={() => setCreating(false)}
          onCreated={(secret) => {
            setCreating(false);
            onSecret({ title: 'Webhook created', what: 'signing secret', value: secret });
            void refresh();
          }}
        />
      )}
      {history && <DeliveriesDialog hook={history} onClose={() => setHistory(undefined)} />}
    </section>
  );
}

function WebhookDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (secret: string) => void }) {
  const options = useOptions();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('https://');
  const [events, setEvents] = useState<string[]>([]);
  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ secret: string }>('/v1/integrations/webhooks', {
        method: 'POST',
        body: { name, url, events },
      }),
    onSuccess: (r) => onCreated(r.secret),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a webhook"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !name || events.length === 0} onClick={() => save.mutate()}>
            Add
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <Field id="wh-name" label="Name">
          <Input id="wh-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          id="wh-url"
          label="Address"
          hint="A public https address. Private and internal addresses aren’t allowed."
        >
          <Input id="wh-url" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[13px] font-medium">Send me events when</legend>
          {options.data?.events.map((ev) => (
            <label key={ev} className="flex items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={events.includes(ev)}
                onChange={(e) =>
                  setEvents(e.target.checked ? [...events, ev] : events.filter((x) => x !== ev))
                }
              />
              <span>{EVENT_LABEL[ev] ?? ev}</span>
            </label>
          ))}
        </fieldset>
      </div>
    </Dialog>
  );
}

function DeliveriesDialog({ hook, onClose }: { hook: Webhook; onClose: () => void }) {
  const deliveries = useQuery({
    queryKey: integrationKeys.deliveries(hook.id),
    queryFn: () => apiFetch<WebhookDelivery[]>(`/v1/integrations/webhooks/${hook.id}/deliveries`),
    refetchInterval: 15_000,
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Deliveries · ${hook.name}`}
      description="The latest events and how sending went. Contents aren’t kept."
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {deliveries.isPending ? (
        <Loading />
      ) : deliveries.isError ? (
        <Alert tone="error">{errorMessage(deliveries.error)}</Alert>
      ) : deliveries.data.length === 0 ? (
        <EmptyState title="Nothing sent yet" />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {deliveries.data.map((d) => (
            <li key={d.id} className="flex flex-col gap-1 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{EVENT_LABEL[d.eventType] ?? d.eventType}</span>
                <Badge tone={DELIVERY_TONE[d.status]}>
                  {d.status === 'SENT' ? 'Sent' : d.status === 'FAILED' ? 'Gave up' : 'Waiting'}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(d.createdAt)} · {d.attempts} {d.attempts === 1 ? 'try' : 'tries'}
                {d.lastStatusCode ? ` · answered ${d.lastStatusCode}` : ''}
                {d.nextAttemptAt ? ` · next try ${formatDateTime(d.nextAttemptAt)}` : ''}
              </span>
              {d.lastError && d.status !== 'SENT' && (
                <span className="text-xs text-danger">{d.lastError}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function ApiKeys({
  readOnly,
  onSecret,
  onNotice,
}: {
  readOnly: boolean;
  onSecret: (s: Shown) => void;
  onNotice: (text: string) => void;
}) {
  const client = useQueryClient();
  const keys = useQuery({
    queryKey: integrationKeys.keys,
    queryFn: () => apiFetch<ApiKeyRow[]>('/v1/integrations/api-keys'),
  });
  const [creating, setCreating] = useState(false);
  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/v1/integrations/api-keys/${id}/revoke`, { method: 'POST' }),
    onSuccess: async () => {
      onNotice('The key no longer works.');
      await client.invalidateQueries({ queryKey: integrationKeys.keys });
    },
  });

  return (
    <section className="flex flex-col gap-3" aria-labelledby="keys-h">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 id="keys-h" className="text-lg font-semibold">
            API keys
          </h2>
          <p className="text-[13px] text-muted-foreground">
            A system you trust sends the key as <code>Authorization: Bearer …</code> to read the data you
            allow. Revoke a key the moment it’s no longer needed.
          </p>
        </div>
        {!readOnly && <Button onClick={() => setCreating(true)}>Create a key</Button>}
      </div>
      {revoke.isError && <Alert tone="error">{errorMessage(revoke.error)}</Alert>}
      {keys.isPending ? (
        <Loading />
      ) : keys.isError ? (
        <Alert tone="error">{errorMessage(keys.error)}</Alert>
      ) : keys.data.length === 0 ? (
        <EmptyState title="No API keys yet">
          Create one for a system that needs to read your directory.
        </EmptyState>
      ) : (
        <Table label="API keys">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Key starts with</Th>
              <Th>Last used</Th>
              <Th>Expires</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {keys.data.map((k) => (
              <tr key={k.id}>
                <Td>{k.name}</Td>
                <Td>
                  <code>{k.prefix}…</code>
                </Td>
                <Td>{k.lastUsedAt ? formatDateTime(k.lastUsedAt) : 'Never'}</Td>
                <Td>{k.expiresAt ? formatDateTime(k.expiresAt) : 'Doesn’t expire'}</Td>
                <Td>
                  {k.revokedAt ? (
                    <Badge tone="danger">Revoked</Badge>
                  ) : k.active ? (
                    <Badge tone="success">Active</Badge>
                  ) : (
                    <Badge tone="warning">Expired</Badge>
                  )}
                </Td>
                <Td>
                  {!readOnly && !k.revokedAt && (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(k.id)}
                    >
                      Revoke
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {creating && (
        <KeyDialog
          onClose={() => setCreating(false)}
          onCreated={(key) => {
            setCreating(false);
            onSecret({ title: 'API key created', what: 'key', value: key });
            void client.invalidateQueries({ queryKey: integrationKeys.keys });
          }}
        />
      )}
    </section>
  );
}

function KeyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (key: string) => void }) {
  const options = useOptions();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [days, setDays] = useState('');
  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ key: string }>('/v1/integrations/api-keys', {
        method: 'POST',
        body: { name, scopes, ...(days ? { expiresInDays: Number(days) } : {}) },
      }),
    onSuccess: (r) => onCreated(r.key),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Create an API key"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !name || scopes.length === 0} onClick={() => save.mutate()}>
            Create
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <Field id="key-name" label="Name" hint="For example, the system that will use it.">
          <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[13px] font-medium">It can</legend>
          {options.data?.scopes.map((s) => (
            <label key={s} className="flex items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={scopes.includes(s)}
                onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))}
              />
              <span>{SCOPE_LABEL[s] ?? s}</span>
            </label>
          ))}
        </fieldset>
        <Field id="key-days" label="Expires after (days)" hint="Leave empty for a key that doesn’t expire.">
          <Input
            id="key-days"
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 3))}
          />
        </Field>
      </div>
    </Dialog>
  );
}
