'use client';

import { PlatformPage } from '@/components/platform/platform-page';
import { LicenceRegisterView } from './licence-register';

export default function PlatformLicenceRegisterPage() {
  return (
    <PlatformPage active="Licence register">
      {(session) => <LicenceRegisterView session={session} />}
    </PlatformPage>
  );
}
