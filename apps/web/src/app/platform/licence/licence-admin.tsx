'use client';

import { FEATURES, isFeature, isLimitKey, LIMITS } from '@smart-hr/entitlements';
import { installLicenceSchema } from '@smart-hr/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ReauthPrompt } from '@/components/reauth-prompt';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { ApiError, apiFetch, type SessionView } from '@/lib/api';
import { formatDate, formatLimit } from '@/lib/plan';
import { SESSION_KEY } from '@/lib/session';

type LicenceStatus = 'VALID' | 'NOT_YET_VALID' | 'GRACE' | 'EXPIRED' | 'WRONG_INSTALLATION';

interface LicenceOverview {
  deploymentMode: 'saas' | 'dedicated' | 'inhouse';
  installationId: string;
  current: {
    licenceId: string;
    installedAt: string;
    failure: string | null;
    state: { status: LicenceStatus; expiresAt: string; graceEndsAt: string | null; daysLeft: number } | null;
    payload: {
      customer: { name: string };
      plan: { code: string; name: string };
      supportLevel: string;
      features: string[];
      limits: Record<string, number | null>;
      notBefore: string;
      expiresAt: string;
      graceDays: number;
      maxOrganisations: number | null;
      boundToThisInstallation: boolean;
    } | null;
  } | null;
  history: {
    licenceId: string;
    customerName: string;
    planCode: string;
    expiresAt: string;
    installedAt: string;
    replacedAt: string | null;
    installedBy: { displayName: string; email: string } | null;
  }[];
}

const LICENCE_KEY = ['platform', 'licence'] as const;

const STATUS: Record<LicenceStatus, { tone: 'success' | 'warning' | 'danger'; text: string }> = {
  VALID: { tone: 'success', text: 'Valid' },
  NOT_YET_VALID: { tone: 'warning', text: 'Not valid yet' },
  GRACE: { tone: 'warning', text: 'In grace period' },
  EXPIRED: { tone: 'danger', text: 'Expired — paid modules are read-only' },
  WRONG_INSTALLATION: { tone: 'danger', text: 'Issued for another installation' },
};

export function LicenceAdmin({ session }: { session: SessionView }) {
  const client = useQueryClient();
  const overview = useQuery({
    queryKey: LICENCE_KEY,
    queryFn: () => apiFetch<LicenceOverview>('/v1/platform/licence'),
  });
  const [text, setText] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const [needsReauth, setNeedsReauth] = useState(false);
  const install = useMutation({
    mutationFn: (licence: string) => apiFetch('/v1/platform/licence', { method: 'PUT', body: { licence } }),
    onSuccess: async () => {
      setText('');
      setNotice({ tone: 'success', text: 'Licence installed. Every organisation now uses it.' });
      await client.invalidateQueries({ queryKey: LICENCE_KEY });
      await client.invalidateQueries({ queryKey: SESSION_KEY });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'REAUTH_REQUIRED') setNeedsReauth(true);
      else if (e instanceof ApiError && e.fieldErrors[0]) setFieldError(e.detail);
      else setNotice({ tone: 'error', text: errorMessage(e) });
    },
  });
  const submit = () => {
    setNotice(undefined);
    const parsed = installLicenceSchema.safeParse({ licence: text });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message);
      return;
    }
    setFieldError(undefined);
    install.mutate(parsed.data.licence);
  };

  if (overview.isPending) return <Loading />;
  if (overview.isError) return <Alert tone="error">{errorMessage(overview.error)}</Alert>;
  const { current, history, installationId, deploymentMode } = overview.data;
  const inHouse = deploymentMode === 'inhouse';

  return (
    <>
      <PageHeader
        title="Licence"
        description="In-house installations run on a signed licence, checked on this server. Nothing is sent to Smartclues."
      />
      {!inHouse && (
        <Alert tone="info">
          This deployment uses subscriptions, managed under Organisations. Licences are only for in-house
          installations.
        </Alert>
      )}
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <section
        aria-labelledby="current-heading"
        className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5"
      >
        <h2 id="current-heading" className="font-semibold">
          Current licence
        </h2>
        <p className="text-[13px] text-muted-foreground">
          Installation ID <span className="font-mono text-foreground">{installationId}</span> — send this to
          Smartclues to get a licence bound to this installation.
        </p>
        {!current ? (
          <p>No licence installed. Organisation administration works; paid modules are off.</p>
        ) : current.failure || !current.payload || !current.state ? (
          <Alert tone="error">
            The installed licence can’t be verified with this installation’s keys. Paid modules are read-only
            until a valid licence is installed.
          </Alert>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS[current.state.status].tone}>{STATUS[current.state.status].text}</Badge>
              <span className="text-[13px] text-muted-foreground">
                {current.state.status === 'VALID' &&
                  `${current.state.daysLeft} day${current.state.daysLeft === 1 ? '' : 's'} left`}
                {current.state.status === 'GRACE' &&
                  `Paid modules become read-only on ${formatDate(current.state.graceEndsAt)}`}
              </span>
            </div>
            {current.state.status === 'VALID' && current.state.daysLeft <= 30 && (
              <Alert tone="warning">This licence expires soon. Ask Smartclues for a renewal.</Alert>
            )}
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4 text-sm">
              <Fact label="Licensed to" value={current.payload.customer.name} />
              <Fact label="Plan" value={current.payload.plan.name} />
              <Fact label="Valid from" value={formatDate(current.payload.notBefore)} />
              <Fact label="Expires" value={formatDate(current.payload.expiresAt)} />
              <Fact label="Grace after expiry" value={`${current.payload.graceDays} days`} />
              <Fact
                label="Organisations"
                value={
                  current.payload.maxOrganisations === null
                    ? 'Unlimited'
                    : `Up to ${current.payload.maxOrganisations}`
                }
              />
              <Fact label="Support" value={sentenceCase(current.payload.supportLevel)} />
              <Fact
                label="Bound to"
                value={current.payload.boundToThisInstallation ? 'This installation' : 'Any installation'}
              />
            </dl>
            <h3 className="text-[13px] font-semibold">Modules</h3>
            <ul className="flex flex-wrap gap-1.5">
              {current.payload.features.filter(isFeature).map((f) => (
                <li key={f}>
                  <Badge tone="neutral">{FEATURES[f].label}</Badge>
                </li>
              ))}
            </ul>
            {Object.keys(current.payload.limits).length > 0 && (
              <>
                <h3 className="text-[13px] font-semibold">Limits</h3>
                <ul className="text-[13px]">
                  {Object.entries(current.payload.limits).map(([key, value]) =>
                    isLimitKey(key) ? (
                      <li key={key}>
                        {LIMITS[key].label}: {formatLimit(value, LIMITS[key].unit)}
                      </li>
                    ) : null,
                  )}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      {inHouse && (
        <section
          aria-labelledby="install-heading"
          className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5"
        >
          <h2 id="install-heading" className="font-semibold">
            Install a licence
          </h2>
          <Field
            id="licence-text"
            label="Licence"
            error={fieldError}
            hint="Paste the whole text, starting with SHRL1."
          >
            <textarea
              rows={4}
              spellCheck={false}
              {...fieldAria('licence-text', fieldError, 'hint')}
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs break-all"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          {needsReauth ? (
            <ReauthPrompt
              reason="Confirm it’s you before changing this installation’s licence."
              mfaEnabled={session.user.mfaEnabled}
              onCancel={() => setNeedsReauth(false)}
              onDone={() => {
                setNeedsReauth(false);
                submit();
              }}
            />
          ) : (
            <div>
              <Button disabled={install.isPending || !text.trim()} onClick={submit}>
                Install licence
              </Button>
            </div>
          )}
        </section>
      )}

      {history.length > 0 && (
        <Table label="Licence history">
          <thead>
            <tr>
              <Th>Installed</Th>
              <Th>Plan</Th>
              <Th>Expires</Th>
              <Th>Installed by</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.licenceId}>
                <Td>{formatDate(h.installedAt)}</Td>
                <Td>{h.planCode}</Td>
                <Td>{formatDate(h.expiresAt)}</Td>
                <Td>{h.installedBy?.displayName ?? '—'}</Td>
                <Td>{h.replacedAt ? `Replaced ${formatDate(h.replacedAt)}` : 'Current'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

const sentenceCase = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();
