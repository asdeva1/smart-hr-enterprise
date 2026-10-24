'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { errorMessage, formatDateTime } from '@/lib/admin';
import { ApiError, apiFetch } from '@/lib/api';
import { parseDomains, ssoKeys, type SsoConnection, type SsoSettings } from '@/lib/sso';

export function SsoAdmin() {
  const settings = useQuery({
    queryKey: ssoKeys.settings,
    queryFn: () => apiFetch<SsoSettings>('/v1/sso/connection'),
  });
  return (
    <>
      <PageHeader
        title="Single sign-on"
        description="Let people sign in with your organisation’s own account, such as Microsoft Entra, Okta or Google Workspace."
      />
      {settings.isPending ? (
        <Loading />
      ) : settings.isError ? (
        <Alert tone="error">{errorMessage(settings.error)}</Alert>
      ) : (
        <SsoForm settings={settings.data} />
      )}
    </>
  );
}

function SsoForm({ settings }: { settings: SsoSettings }) {
  const client = useQueryClient();
  const c: SsoConnection | null = settings.connection;
  const [issuer, setIssuer] = useState(c?.issuer ?? '');
  const [clientId, setClientId] = useState(c?.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [domains, setDomains] = useState((c?.allowedDomains ?? []).join('\n'));
  const [requireVerified, setRequireVerified] = useState(c?.requireVerifiedEmail ?? true);
  const [enabled, setEnabled] = useState(c?.enabled ?? false);
  const [enforced, setEnforced] = useState(c?.enforced ?? false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () =>
      apiFetch<SsoSettings>('/v1/sso/connection', {
        method: 'PUT',
        body: {
          issuer: issuer.trim(),
          clientId: clientId.trim(),
          ...(clientSecret ? { clientSecret } : {}),
          allowedDomains: parseDomains(domains),
          requireVerifiedEmail: requireVerified,
          enabled,
          enforced: enabled && enforced,
        },
      }),
    onSuccess: (data) => {
      setFieldErrors({});
      setClientSecret('');
      setNotice({ tone: 'success', text: 'Single sign-on settings saved.' });
      client.setQueryData(ssoKeys.settings, data);
    },
    onError: (error) => {
      setFieldErrors(
        error instanceof ApiError ? Object.fromEntries(error.fieldErrors.map((f) => [f.path, f.message])) : {},
      );
      setNotice({ tone: 'error', text: errorMessage(error) });
    },
  });

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <section aria-labelledby="sso-steps" className="rounded-lg border border-border bg-card p-6">
        <h2 id="sso-steps" className="text-[17px] font-semibold">
          1. Register Smart HR with your identity provider
        </h2>
        <p className="mt-2 text-muted-foreground">
          Create an “OpenID Connect” (web) application there. When it asks for a redirect or sign-in return
          address, give it this one, exactly:
        </p>
        <p className="mt-3 break-all rounded-md border border-border bg-muted px-3 py-2 font-mono text-[13px]">
          {settings.redirectUri}
        </p>
        <p className="mt-3 text-muted-foreground">
          Then copy the provider’s issuer address, client ID and client secret into the form below.
        </p>
      </section>

      <form
        className="flex flex-col gap-5 rounded-lg border border-border bg-card p-6"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setNotice(undefined);
          save.mutate();
        }}
      >
        <h2 className="text-[17px] font-semibold">2. Enter its details</h2>
        <Field
          id="issuer"
          label="Issuer address"
          hint="For example https://login.microsoftonline.com/<tenant-id>/v2.0 or https://accounts.google.com"
          error={fieldErrors.issuer}
        >
          <Input id="issuer" value={issuer} onChange={(e) => setIssuer(e.target.value)} autoComplete="off" />
        </Field>
        <Field id="clientId" label="Client ID" error={fieldErrors.clientId}>
          <Input id="clientId" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
        </Field>
        <Field
          id="clientSecret"
          label="Client secret"
          hint={c?.hasSecret ? 'A secret is saved. Leave this empty to keep it.' : undefined}
          error={fieldErrors.clientSecret}
        >
          <Input
            id="clientSecret"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field
          id="domains"
          label="Email domains that may use it"
          hint="One per line, such as example.com. People on other domains keep signing in with a password."
          error={fieldErrors.allowedDomains}
        >
          <textarea
            id="domains"
            rows={3}
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-[15px]"
          />
        </Field>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={requireVerified}
            onChange={(e) => setRequireVerified(e.target.checked)}
          />
          <span>
            Only accept email addresses the provider has confirmed
            <span className="block text-xs text-muted-foreground">
              Recommended. Turn off only if your provider never sends this.
            </span>
          </span>
        </label>

        <h2 className="text-[17px] font-semibold">3. Turn it on</h2>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              if (!e.target.checked) setEnforced(false);
            }}
          />
          <span>
            Allow single sign-on
            <span className="block text-xs text-muted-foreground">
              Members are added by an administrator as usual. Signing in never creates an account.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={enforced}
            disabled={!enabled}
            onChange={(e) => setEnforced(e.target.checked)}
          />
          <span>
            Require it for members
            <span className="block text-xs text-muted-foreground">
              Members can no longer use a password here. Organisation administrators still can, so a wrong
              setting never locks everyone out. Try single sign-on yourself before turning this on.
            </span>
          </span>
        </label>
        {c?.lastLoginAt && (
          <p className="text-xs text-muted-foreground">Last used {formatDateTime(c.lastLoginAt)}.</p>
        )}
        <div>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </form>
    </div>
  );
}
