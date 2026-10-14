'use client';

import { PlatformPage } from '@/components/platform/platform-page';
import { LicenceAdmin } from './licence-admin';

export default function PlatformLicencePage() {
  return <PlatformPage active="Licence">{(session) => <LicenceAdmin session={session} />}</PlatformPage>;
}
