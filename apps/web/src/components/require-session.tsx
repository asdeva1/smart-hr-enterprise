'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import type { SessionView } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert } from './ui/alert';

/**
 * Client-side gate for signed-in pages. It only decides what to show and where to navigate;
 * the API enforces authentication and authorization on every request independently.
 */
export function RequireSession({
  children,
  requireTenant = true,
}: {
  children: (session: SessionView) => ReactNode;
  requireTenant?: boolean;
}) {
  const { data: session, isPending, isError } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isPending || isError) return;
    if (!session || session.mfaPending) {
      router.replace(
        `/login?next=${encodeURIComponent(pathname)}${session === null ? '&reason=signed-out' : ''}`,
      );
    } else if (requireTenant && !session.activeTenant && session.memberships.length > 0) {
      router.replace(`/select-organisation?next=${encodeURIComponent(pathname)}`);
    }
  }, [session, isPending, isError, requireTenant, router, pathname]);

  if (isError) {
    return (
      <div className="p-8">
        <Alert tone="error">We couldn’t reach Smart HR. Check your connection and reload the page.</Alert>
      </div>
    );
  }
  if (
    isPending ||
    !session ||
    session.mfaPending ||
    (requireTenant && !session.activeTenant && session.memberships.length > 0)
  ) {
    return (
      <div className="grid min-h-screen place-items-center text-muted-foreground" role="status">
        Loading…
      </div>
    );
  }
  return <>{children(session)}</>;
}
