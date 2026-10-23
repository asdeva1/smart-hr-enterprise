'use client';

import { useParams } from 'next/navigation';
import { PlatformPage } from '@/components/platform/platform-page';
import { OrganisationDetail } from './organisation-detail';

export default function PlatformOrganisationPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PlatformPage active="Organisations">
      {(session) => (
        <OrganisationDetail
          tenantId={id}
          usesLicence={session.deploymentMode === 'inhouse'}
          mfaEnabled={session.user.mfaEnabled}
        />
      )}
    </PlatformPage>
  );
}
