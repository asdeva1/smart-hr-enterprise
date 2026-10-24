'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { SsoAdmin } from './sso-admin';

export default function SsoPage() {
  return (
    <RequireSession permission="security.manage">
      {(session) => (
        <AppShell active="Single sign-on" session={session}>
          <SsoAdmin />
        </AppShell>
      )}
    </RequireSession>
  );
}
