import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { safeEqual } from '@smart-hr/auth';
import { withContext, type DatabaseClient } from '@smart-hr/database';
import { AppError, type Permission } from '@smart-hr/shared';
import type { AppRequest } from '../common/request-context.js';
import type { ApiEnv } from '../config/env.js';
import { API_ENV, DATABASE } from '../infra/tokens.js';
import { ASSIGNMENT_SELECT, permissionSetFrom } from '../rbac/rbac.service.js';
import { AUTH_META } from './auth.decorators.js';
import { CSRF_HEADER, SESSION_COOKIE } from './auth.types.js';
import { SessionService } from './session.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard. Authentication is the default: a route must opt out with @Public().
 * Order of checks: origin → session → second factor → CSRF → recent auth → platform admin → tenant
 * (membership, organisation MFA policy, owner flag, permissions).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private flag(ctx: ExecutionContext, key: string): boolean {
    return this.reflector.getAllAndOverride<boolean>(key, [ctx.getHandler(), ctx.getClass()]) === true;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const unsafe = !SAFE_METHODS.has(req.method);

    // Browsers always send Origin on cross-site state-changing requests. Non-browser clients may omit it.
    if (unsafe) {
      const origin = req.headers.origin;
      if (typeof origin === 'string' && !this.env.CORS_ORIGINS.includes(origin)) {
        throw new AppError('ORIGIN_NOT_ALLOWED', 'Request origin is not allowed', 403);
      }
    }

    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const token = cookies?.[SESSION_COOKIE];
    if (token) {
      const resolved = await this.sessions.resolve(token);
      if (resolved) req.auth = resolved;
    }

    if (this.flag(ctx, AUTH_META.public)) return true;

    const auth = req.auth;
    if (!auth) {
      throw token
        ? new AppError('SESSION_EXPIRED', 'Your session has ended. Please sign in again.', 401)
        : new AppError('UNAUTHENTICATED', 'Sign in to continue', 401);
    }

    if (auth.session.mfaPending && !this.flag(ctx, AUTH_META.allowMfaPending)) {
      throw new AppError('MFA_REQUIRED', 'Enter your verification code to finish signing in', 401);
    }

    if (unsafe) {
      const header = req.headers[CSRF_HEADER];
      if (typeof header !== 'string' || !safeEqual(header, auth.session.csrfToken)) {
        throw new AppError(
          'CSRF_INVALID',
          'Your request could not be verified. Reload the page and try again.',
          403,
        );
      }
    }

    if (this.flag(ctx, AUTH_META.recentAuth)) {
      const at = auth.session.reauthenticatedAt;
      if (!at || Date.now() - at.getTime() > this.env.AUTH_REAUTH_MINUTES * 60_000) {
        throw new AppError('REAUTH_REQUIRED', 'Confirm your password to continue', 403);
      }
    }

    if (this.flag(ctx, AUTH_META.platformAdmin) && !auth.user.isPlatformAdmin) {
      throw new AppError('FORBIDDEN', 'You do not have permission to do this', 403);
    }

    const needsAdmin = this.flag(ctx, AUTH_META.tenantAdmin);
    const required =
      this.reflector.getAllAndOverride<Permission[] | undefined>(AUTH_META.permissions, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? [];
    if (needsAdmin || required.length > 0 || this.flag(ctx, AUTH_META.tenant)) {
      const tenantId = auth.session.activeTenantId;
      if (!tenantId) throw new AppError('TENANT_REQUIRED', 'Choose an organisation first', 403);
      // Re-checked every request: a suspended membership or tenant, or a removed role, takes effect immediately.
      const membership = await withContext(this.db, { tenantId, userId: auth.user.id }, (tx) =>
        tx.tenantMembership.findFirst({
          where: { tenantId, userId: auth.user.id, status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
          include: { tenant: { select: { requireMfa: true } }, assignments: { select: ASSIGNMENT_SELECT } },
        }),
      );
      if (!membership) throw new AppError('FORBIDDEN', 'You no longer have access to this organisation', 403);

      // Organisation policy: members must turn on two-step verification before using the organisation.
      if (membership.tenant.requireMfa && !auth.user.mfaEnabledAt) {
        throw new AppError(
          'MFA_ENROLMENT_REQUIRED',
          'Your organisation requires two-step verification. Turn it on to continue.',
          403,
        );
      }

      const permissions = permissionSetFrom(tenantId, membership.isTenantAdmin, membership.assignments);
      if (needsAdmin && !membership.isTenantAdmin) {
        throw new AppError('FORBIDDEN', 'You do not have permission to do this', 403);
      }
      if (!required.every((code) => permissions.hasAnywhere(code))) {
        throw new AppError('FORBIDDEN', 'You do not have permission to do this', 403);
      }
      auth.tenant = {
        id: tenantId,
        membershipId: membership.id,
        isTenantAdmin: membership.isTenantAdmin,
        permissions,
      };
    }

    return true;
  }
}
