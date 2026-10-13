import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { AppError } from '@smart-hr/shared';
import type { AppRequest } from '../common/request-context.js';
import type { AuthContext } from './auth.types.js';

export const AUTH_META = {
  public: 'auth:public',
  allowMfaPending: 'auth:allowMfaPending',
  tenant: 'auth:tenant',
  tenantAdmin: 'auth:tenantAdmin',
  platformAdmin: 'auth:platformAdmin',
  recentAuth: 'auth:recentAuth',
} as const;

/** No session required. Every other route requires one by default. */
export const Public = () => SetMetadata(AUTH_META.public, true);

/** Reachable by a session that has passed the password but not yet the second factor. */
export const AllowMfaPending = () => SetMetadata(AUTH_META.allowMfaPending, true);

/** Requires an active tenant; membership is re-checked on every request. */
export const RequireTenant = () => SetMetadata(AUTH_META.tenant, true);

/** Requires the caller to administer the active tenant. Replaced by fine-grained permissions in Phase 3. */
export const RequireTenantAdmin = () => SetMetadata(AUTH_META.tenantAdmin, true);

export const RequirePlatformAdmin = () => SetMetadata(AUTH_META.platformAdmin, true);

/** Requires the user to have entered their password (and code) again within AUTH_REAUTH_MINUTES. */
export const RequireRecentAuth = () => SetMetadata(AUTH_META.recentAuth, true);

/** The authenticated caller. Only usable on routes the guard has authenticated. */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<AppRequest>().auth;
  if (!auth) throw new AppError('UNAUTHENTICATED', 'Sign in to continue', 401);
  return auth;
});

/** The active tenant, verified by the guard. Only usable with @RequireTenant. */
export const CurrentTenant = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const tenant = ctx.switchToHttp().getRequest<AppRequest>().auth?.tenant;
  if (!tenant) throw new AppError('TENANT_REQUIRED', 'Choose an organisation first', 403);
  return tenant;
});
