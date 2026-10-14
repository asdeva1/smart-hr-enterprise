'use client';

import { useParams } from 'next/navigation';
import { PlatformPage } from '@/components/platform/platform-page';
import { SubscriptionManager } from './subscription-manager';

export default function PlatformOrganisationPage() {
  const { id } = useParams<{ id: string }>();
  return <PlatformPage active="Organisations">{() => <SubscriptionManager tenantId={id} />}</PlatformPage>;
}
