'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import type { SessionView } from '@/lib/api';
import { can } from '@/lib/permissions';
import { useSession } from '@/lib/session';
import { Alert } from './ui/alert';

const MFA_SETUP_PATH = '/account/security';

/**
 * Client-side gate for signed-in pages. It only decides what to show and where to navigate;
 * the API enforces authentication and authorization on every request independently.
 */
export function RequireSession({
  children,
  requireTenant = true,
  permission,
}: {
  children: (session: SessionView) => ReactNode;
  requireTenant?: boolean;
  /** Shows a "no access" message instead of the page when the member lacks this permission. */
  permission?: string;
}) {
  const { data: session, isPending, isError } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  const mustEnrol = !!session?.activeTenant?.mfaEnrolmentRequired && pathname !== MFA_SETUP_PATH;

  useEffect(() => {
    if (isPending || isError) return;
    if (!session || session.mfaPending) {
      router.replace(
        `/login?next=${encodeURIComponent(pathname)}${session === null ? '&reason=signed-out' : ''}`,
      );
    } else if (requireTenant && !session.activeTenant && session.memberships.length > 0) {
      router.replace(`/select-organisation?next=${encodeURIComponent(pathname)}`);
    } else if (mustEnrol) {
      router.replace(`${MFA_SETUP_PATH}?required=1`);
    }
  }, [session, isPending, isError, requireTenant, router, pathname, mustEnrol]);

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
    mustEnrol ||
    (requireTenant && !session.activeTenant && session.memberships.length > 0)
  ) {
    return (
      <div className="grid min-h-screen place-items-center text-muted-foreground" role="status">
        Loading…
      </div>
    );
  }
  if (permission && !can(session, permission)) {
    return (
      <div className="grid min-h-screen place-items-center p-8">
        <div className="flex max-w-md flex-col gap-3 text-center">
          <h1 className="text-xl font-semibold">You don’t have access to this page</h1>
          <p className="text-muted-foreground">
            Ask an administrator of {session.activeTenant?.name ?? 'your organisation'} if you need it.
          </p>
          <Link href="/" className="text-primary hover:underline">
            Back to the dashboard
          </Link>
        </div>
      </div>
    );
  }
  return <>{children(session)}</>;
}
