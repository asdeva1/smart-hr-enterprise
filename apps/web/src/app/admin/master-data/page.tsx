'use client';

import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { MasterDataAdmin } from './master-data-admin';

export default function MasterDataPage() {
  return (
    <RequireSession permission="master_data.manage">
      {(session) => (
        <AppShell active="Reference lists" session={session}>
          <MasterDataAdmin />
        </AppShell>
      )}
    </RequireSession>
  );
}
