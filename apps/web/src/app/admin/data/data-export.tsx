'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { ReauthPrompt } from '@/components/reauth-prompt';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { errorMessage } from '@/lib/admin';
import { ApiError, apiFetch, type SessionView } from '@/lib/api';

/** Downloads everything the organisation holds as one JSON file. Owners only; the API asks for the password. */
export function DataExport({ session }: { session: SessionView }) {
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const [needsReauth, setNeedsReauth] = useState(false);
  const download = useMutation({
    mutationFn: () => apiFetch<unknown>('/v1/tenant/export'),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `smart-hr-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice({ tone: 'success', text: 'Export downloaded. It has been recorded in the audit log.' });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'REAUTH_REQUIRED') setNeedsReauth(true);
      else setNotice({ tone: 'error', text: errorMessage(e) });
    },
  });
  const offboarding = session.activeTenant?.status === 'OFFBOARDING';

  return (
    <>
      <PageHeader
        title="Your data"
        description="Everything your organisation keeps in Smart HR belongs to you. Download it at any time."
      />
      {offboarding && (
        <Alert tone="warning">
          This organisation is being offboarded. Download your data before access ends.
        </Alert>
      )}
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <section
        aria-labelledby="export-heading"
        className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6"
      >
        <h2 id="export-heading" className="text-[17px] font-semibold">
          Full export
        </h2>
        <p className="max-w-prose text-muted-foreground">
          One JSON file with your organisation structure, members, roles, settings, reference lists,
          approvals, subscription and audit log. Passwords, sign-in secrets and recovery codes are never
          included.
        </p>
        {needsReauth ? (
          <ReauthPrompt
            reason="Confirm it’s you before downloading all of your organisation’s data."
            mfaEnabled={session.user.mfaEnabled}
            onCancel={() => setNeedsReauth(false)}
            onDone={() => {
              setNeedsReauth(false);
              download.mutate();
            }}
          />
        ) : (
          <div>
            <Button
              disabled={download.isPending}
              onClick={() => {
                setNotice(undefined);
                download.mutate();
              }}
            >
              {download.isPending ? 'Preparing…' : 'Download export'}
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
