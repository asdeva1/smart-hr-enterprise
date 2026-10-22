'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import { hasFeature } from '@/lib/permissions';
import { AiControls } from './ai-controls';

export default function AiControlsPage() {
  return (
    <RequireSession permission="settings.manage">
      {(session) => (
        <AppShell active="AI controls" session={session}>
          {hasFeature(session, 'ai.assistant') ? (
            <AiControls governance={hasFeature(session, 'ai.governance')} />
          ) : (
            <Alert tone="info">Your organisation’s plan doesn’t include AI.</Alert>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}
