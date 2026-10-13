'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { SettingsAdmin } from './settings-admin';

export default function SettingsPage() {
  return (
    <RequireSession permission="settings.manage">
      {(session) => (
        <AppShell active="Organisation settings" session={session}>
          <SettingsAdmin />
        </AppShell>
      )}
    </RequireSession>
  );
}
