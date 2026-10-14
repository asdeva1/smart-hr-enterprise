'use client';

import { PlatformPage } from '@/components/platform/platform-page';
import { PlansAdmin } from './plans-admin';

export default function PlatformPlansPage() {
  return <PlatformPage active="Plan catalogue">{() => <PlansAdmin />}</PlatformPage>;
}
