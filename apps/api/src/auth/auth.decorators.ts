import { applyDecorators, createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Feature } from '@smart-hr/entitlements';
import { AppError, type Permission } from '@smart-hr/shared';
import type { AppRequest } from '../common/request-context.js';
import type { AuthContext, TenantContext } from './auth.types.js';

export const AUTH_META = {
  public: 'auth:public',
  allowMfaPending: 'auth:allowMfaPending',
  tenant: 'auth:tenant',
  tenantAdmin: 'auth:tenantAdmin',
  platformAdmin: 'auth:platformAdmin',
  recentAuth: 'auth:recentAuth',
  permissions: 'auth:permissions',
  feature: 'auth:feature',
} as const;

/** No session required. Every other route requires one by default. */
export const Public = () => SetMetadata(AUTH_META.public, true);

/** Reachable by a session that has passed the password but not yet the second factor. */
export const AllowMfaPending = () => SetMetadata(AUTH_META.allowMfaPending, true);

/** Requires an active tenant; membership is re-checked on every request. */
export const RequireTenant = () => SetMetadata(AUTH_META.tenant, true);

/** Requires an organisation owner. Use only for owner-level actions such as granting ownership. */
export const RequireTenantAdmin = () => SetMetadata(AUTH_META.tenantAdmin, true);

/**
 * Requires every listed permission somewhere in the active tenant (any scope). Services then check the
 * scope of the specific record with `PermissionSet.allows`. Implies @RequireTenant.
 */
export const RequirePermission = (...permissions: [Permission, ...Permission[]]) =>
  applyDecorators(SetMetadata(AUTH_META.permissions, permissions), SetMetadata(AUTH_META.tenant, true));

/**
 * Requires the organisation's plan to include a feature (checked on every request, in the backend).
 * Safe methods (GET) only need the feature; changes also need an active subscription — an expired or
 * suspended organisation can still read and export. Implies @RequireTenant.
 */
export const RequireFeature = (feature: Feature) =>
  applyDecorators(SetMetadata(AUTH_META.feature, feature), SetMetadata(AUTH_META.tenant, true));

export const RequirePlatformAdmin = () => SetMetadata(AUTH_META.platformAdmin, true);

/** Requires the user to have entered their password (and code) again within AUTH_REAUTH_MINUTES. */
export const RequireRecentAuth = () => SetMetadata(AUTH_META.recentAuth, true);

/** The authenticated caller. Only usable on routes the guard has authenticated. */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<AppRequest>().auth;
  if (!auth) throw new AppError('UNAUTHENTICATED', 'Sign in to continue', 401);
  return auth;
});

/** The active tenant, verified by the guard. Only usable with @RequireTenant or @RequirePermission. */
export const CurrentTenant = createParamDecorator((_data: unknown, ctx: ExecutionContext): TenantContext => {
  const tenant = ctx.switchToHttp().getRequest<AppRequest>().auth?.tenant;
  if (!tenant) throw new AppError('TENANT_REQUIRED', 'Choose an organisation first', 403);
  return tenant;
});
