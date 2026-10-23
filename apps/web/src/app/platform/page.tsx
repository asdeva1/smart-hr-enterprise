'use client';

import { PlatformDashboard } from '@/components/platform/platform-dashboard';
import { PlatformPage } from '@/components/platform/platform-page';

export default function PlatformHomePage() {
  return (
    <PlatformPage active="Platform dashboard">
      {(session) => <PlatformDashboard session={session} />}
    </PlatformPage>
  );
}
