'use client';

import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { formatDay, useEmploymentChanges } from '@/lib/employees';

/** Employment changes waiting for approval, shown on the employee's page until they are decided. */
export function PendingChanges({ id }: { id: string }) {
  const changes = useEmploymentChanges(id);
  const open = (changes.data ?? []).filter((c) => c.status === 'PENDING' || c.status === 'RETURNED');
  if (open.length === 0) return null;
  return (
    <>
      {open.map((c) => (
        <Alert key={c.id} tone="info">
          {c.actionLabel} from {formatDay(c.effectiveDate)}{' '}
          {c.status === 'RETURNED' ? 'was sent back for changes.' : 'is waiting for approval.'}{' '}
          <Link href={`/employees/changes/${c.id}`} className="font-semibold underline">
            See the change
          </Link>
        </Alert>
      ))}
    </>
  );
}
