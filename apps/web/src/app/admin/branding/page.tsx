'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { BrandingAdmin } from './branding-admin';

export default function BrandingPage() {
  return (
    <RequireSession permission="settings.manage">
      {(session) => (
        <AppShell active="Branding" session={session}>
          <BrandingAdmin session={session} />
        </AppShell>
      )}
    </RequireSession>
  );
}
