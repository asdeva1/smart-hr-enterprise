import type { User, UserSession } from '@smart-hr/database';

/** Attached to every request that carries a valid session. */
export interface AuthContext {
  session: UserSession;
  user: User;
  /** Set by the guard only after the membership has been re-checked for this request. */
  tenant?: { id: string; isTenantAdmin: boolean };
}

export const SESSION_COOKIE = 'shr_session';
export const CSRF_COOKIE = 'shr_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Public shape of the current session, returned by /v1/auth/session and sign-in. */
export interface SessionView {
  user: {
    id: string;
    email: string;
    displayName: string;
    isPlatformAdmin: boolean;
    mfaEnabled: boolean;
  };
  mfaPending: boolean;
  activeTenant: { id: string; name: string; isTenantAdmin: boolean } | null;
  memberships: { tenantId: string; name: string; isTenantAdmin: boolean }[];
  /** When the session ends if idle from now. */
  expiresAt: string;
  /** Hard limit regardless of activity. */
  absoluteExpiresAt: string;
}
