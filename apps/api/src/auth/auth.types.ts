import type { User, UserSession } from '@smart-hr/database';
import type { Access, EffectiveStatus, Entitlements, Feature } from '@smart-hr/entitlements';
import type { Permission, PermissionSet } from '@smart-hr/shared';

/** The active tenant as verified by the guard for this request. */
export interface TenantContext {
  id: string;
  membershipId: string;
  /** Organisation owner: holds every permission. */
  isTenantAdmin: boolean;
  permissions: PermissionSet;
  /** Resolved by the guard on routes gated with @RequireFeature. */
  entitlements?: Entitlements;
}

/** Attached to every request that carries a valid session. */
export interface AuthContext {
  session: UserSession;
  user: User;
  /** Set by the guard only after the membership has been re-checked for this request. */
  tenant?: TenantContext;
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
  activeTenant: {
    id: string;
    name: string;
    isTenantAdmin: boolean;
    /** Permissions held anywhere in the organisation. For showing and hiding UI only; the API checks every request. */
    permissions: Permission[];
    /** The organisation requires two-step verification and this user has not turned it on yet. */
    mfaEnrolmentRequired: boolean;
    /** OFFBOARDING: the organisation is read-only while its data is exported. */
    status: 'ACTIVE' | 'OFFBOARDING';
    branding: { name: string | null; color: string | null; logoUrl: string | null };
    /** The organisation's plan. For showing and hiding UI only; the API enforces entitlements itself. */
    plan: {
      code: string | null;
      name: string | null;
      status: EffectiveStatus;
      access: Access;
      features: Feature[];
      graceEndsAt: string | null;
    };
  } | null;
  memberships: { tenantId: string; name: string; isTenantAdmin: boolean }[];
  /** When the session ends if idle from now. */
  expiresAt: string;
  /** Hard limit regardless of activity. */
  absoluteExpiresAt: string;
}
