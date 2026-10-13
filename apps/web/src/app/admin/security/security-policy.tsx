'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { adminKeys, errorMessage } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import { SESSION_KEY } from '@/lib/session';

export function SecurityPolicy({ session }: { session: SessionView }) {
  const client = useQueryClient();
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const policy = useQuery({
    queryKey: adminKeys.security,
    queryFn: () => apiFetch<{ requireMfa: boolean }>('/v1/admin/security'),
  });
  const update = useMutation({
    mutationFn: (requireMfa: boolean) =>
      apiFetch<{ requireMfa: boolean }>('/v1/admin/security', { method: 'PUT', body: { requireMfa } }),
    onSuccess: async (data) => {
      setNotice({
        tone: 'success',
        text: data.requireMfa
          ? 'Two-step verification is now required. Members without it will be asked to turn it on.'
          : 'Two-step verification is now optional.',
      });
      client.setQueryData(adminKeys.security, data);
      await client.invalidateQueries({ queryKey: SESSION_KEY });
    },
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  });

  return (
    <>
      <PageHeader title="Security policy" description="Rules that apply to everyone in this organisation." />
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <section aria-labelledby="mfa-policy" className="rounded-lg border border-border bg-card p-6">
        <h2 id="mfa-policy" className="text-[17px] font-semibold">
          Two-step verification
        </h2>
        {policy.isPending ? (
          <Loading />
        ) : policy.isError ? (
          <Alert tone="error">{errorMessage(policy.error)}</Alert>
        ) : (
          <div className="mt-2 flex flex-col gap-4">
            <p className="max-w-prose text-muted-foreground">
              {policy.data.requireMfa
                ? 'Required. Members must use an authenticator app code when they sign in, and anyone without one is sent to set it up before they can continue.'
                : 'Optional. Members can turn it on from their account page.'}
            </p>
            {!session.user.mfaEnabled && !policy.data.requireMfa && (
              <Alert tone="info">
                Turn it on for your own account first, so you can’t be locked out.{' '}
                <Link href="/account/security" className="underline">
                  Go to your account
                </Link>
              </Alert>
            )}
            <div>
              <Button
                variant={policy.data.requireMfa ? 'outline' : 'primary'}
                disabled={update.isPending}
                onClick={() => update.mutate(!policy.data.requireMfa)}
              >
                {policy.data.requireMfa ? 'Make it optional' : 'Require for everyone'}
              </Button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
