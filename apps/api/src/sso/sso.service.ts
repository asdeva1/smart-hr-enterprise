import { Inject, Injectable } from '@nestjs/common';
import { normalizeEmail, SecretBox } from '@smart-hr/auth';
import { withContext, type DatabaseClient } from '@smart-hr/database';
import { AppError } from '@smart-hr/shared';
import type { SaveSsoConnectionInput } from '@smart-hr/validation';
import { AuditService, emailFingerprint } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { RateLimiterService } from '../auth/rate-limiter.service.js';
import { SessionService, type IssuedSession } from '../auth/session.service.js';
import type { RequestMeta } from '../common/request-context.js';
import type { ApiEnv } from '../config/env.js';
import { API_ENV, DATABASE } from '../infra/tokens.js';
import { OidcService } from './oidc.service.js';

/** How long a person has to finish signing in at their identity provider. */
const ATTEMPT_MINUTES = 10;

interface Attempt {
  s: string; // state
  n: string; // nonce
  v: string; // PKCE verifier
  t: string; // organisation
  x: string; // where to go afterwards
  e: number; // expiry (ms)
}

/** Error codes that the sign-in page turns into plain-language messages. */
export type SsoFailure =
  | 'expired'
  | 'denied'
  | 'unverified_email'
  | 'wrong_domain'
  | 'no_access'
  | 'provider'
  | 'unavailable';

export class SsoLoginError extends Error {
  constructor(readonly code: SsoFailure) {
    super(code);
  }
}

const view = (c: {
  issuer: string;
  clientId: string;
  allowedDomains: string[];
  requireVerifiedEmail: boolean;
  enabled: boolean;
  enforced: boolean;
  lastLoginAt: Date | null;
  updatedAt: Date;
}) => ({
  issuer: c.issuer,
  clientId: c.clientId,
  hasSecret: true,
  allowedDomains: c.allowedDomains,
  requireVerifiedEmail: c.requireVerifiedEmail,
  enabled: c.enabled,
  enforced: c.enforced,
  lastLoginAt: c.lastLoginAt?.toISOString() ?? null,
  updatedAt: c.updatedAt.toISOString(),
});

@Injectable()
export class SsoService {
  private readonly box: SecretBox;

  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly oidc: OidcService,
    private readonly sessions: SessionService,
    private readonly limiter: RateLimiterService,
    private readonly audit: AuditService,
  ) {
    this.box = new SecretBox(env.DATA_ENCRYPTION_KEYS, env.DATA_ENCRYPTION_KEY_ID);
  }

  static secretAad(tenantId: string) {
    return `sso-secret:${tenantId}`;
  }

  get redirectUri(): string {
    return new URL('/v1/sso/callback', this.env.API_PUBLIC_URL ?? this.env.APP_PUBLIC_URL).toString();
  }

  // ------------------------------------------------------------ administration

  async get(tenant: TenantContext, auth: AuthContext) {
    const connection = await withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, (tx) =>
      tx.ssoConnection.findUnique({ where: { tenantId: tenant.id } }),
    );
    return { redirectUri: this.redirectUri, connection: connection ? view(connection) : null };
  }

  async save(tenant: TenantContext, auth: AuthContext, input: SaveSsoConnectionInput, meta: RequestMeta) {
    const existing = await withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, (tx) =>
      tx.ssoConnection.findUnique({ where: { tenantId: tenant.id } }),
    );
    if (!existing && !input.clientSecret) {
      throw new AppError('VALIDATION_FAILED', 'Enter the client secret', 400, [
        { path: 'clientSecret', message: 'Enter the client secret' },
      ]);
    }
    // Check the provider answers before saving, so a typo is caught here rather than at someone's sign-in.
    try {
      await this.oidc.discover(input.issuer, true);
    } catch (error) {
      throw new AppError(
        'SSO_PROVIDER_ERROR',
        error instanceof AppError ? error.message : 'The identity provider could not be reached',
        400,
        [{ path: 'issuer', message: error instanceof AppError ? error.message : 'Could not be reached' }],
      );
    }
    const data = {
      issuer: input.issuer,
      clientId: input.clientId,
      allowedDomains: [...new Set(input.allowedDomains)],
      requireVerifiedEmail: input.requireVerifiedEmail,
      enabled: input.enabled,
      enforced: input.enforced,
      updatedByUserId: auth.user.id,
      ...(input.clientSecret
        ? { clientSecretSealed: this.box.encrypt(input.clientSecret, SsoService.secretAad(tenant.id)) }
        : {}),
    };
    const saved = await withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, (tx) =>
      existing
        ? tx.ssoConnection.update({ where: { tenantId: tenant.id }, data })
        : tx.ssoConnection.create({
            data: { ...data, tenantId: tenant.id, clientSecretSealed: data.clientSecretSealed! },
          }),
    );
    await this.audit.record(
      {
        action: 'sso.save',
        outcome: 'SUCCESS',
        tenantId: tenant.id,
        actorUserId: auth.user.id,
        targetType: 'sso_connection',
        targetId: saved.id,
        metadata: {
          issuer: saved.issuer,
          enabled: saved.enabled,
          enforced: saved.enforced,
          domains: saved.allowedDomains,
          secretChanged: Boolean(input.clientSecret),
        },
      },
      meta,
    );
    return { redirectUri: this.redirectUri, connection: view(saved) };
  }

  // ------------------------------------------------------------ signing in

  /** The organisation that should sign this email address in, if exactly one does. Never reveals why not. */
  private async connectionFor(rawEmail: string) {
    const email = normalizeEmail(rawEmail);
    const domain = email.split('@')[1];
    if (!domain) return null;
    const user = await this.db.user.findUnique({ where: { email } });
    // Platform operators always sign in with a password and a second factor.
    if (!user || user.status !== 'ACTIVE' || user.isPlatformAdmin) return null;

    const connections = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.sso_lookup', 'on', true)`;
      return tx.ssoConnection.findMany({ where: { enabled: true, allowedDomains: { has: domain } } });
    });
    if (connections.length === 0) return null;

    const memberships = await withContext(this.db, { userId: user.id }, (tx) =>
      tx.tenantMembership.findMany({
        where: {
          userId: user.id,
          status: 'ACTIVE',
          tenantId: { in: connections.map((c) => c.tenantId) },
          tenant: { status: { in: ['ACTIVE', 'OFFBOARDING'] } },
        },
        select: { tenantId: true, tenant: { select: { name: true } } },
      }),
    );
    if (memberships.length !== 1) return null;
    const connection = connections.find((c) => c.tenantId === memberships[0]!.tenantId)!;
    return { connection, user, tenantName: memberships[0]!.tenant.name };
  }

  /** For the sign-in page: does this address sign in through an identity provider? */
  async discover(email: string, meta: RequestMeta) {
    await this.limiter.consume('sso-discover-ip', meta.ip ?? 'unknown', this.env.AUTH_RATE_LIMIT_LOGIN_PER_IP, 60);
    const found = await this.connectionFor(email);
    return found
      ? { sso: true as const, organisation: found.tenantName, enforced: found.connection.enforced }
      : { sso: false as const };
  }

  /** Builds the provider's sign-in address and the sealed cookie that ties the reply to this browser. */
  async start(email: string, next: string | undefined, meta: RequestMeta) {
    await this.limiter.consume('sso-start-ip', meta.ip ?? 'unknown', this.env.AUTH_RATE_LIMIT_LOGIN_PER_IP, 60);
    await this.limiter.consume('sso-start-email', normalizeEmail(email), this.env.AUTH_RATE_LIMIT_LOGIN_PER_EMAIL, 15 * 60);
    const found = await this.connectionFor(email);
    if (!found) throw new SsoLoginError('unavailable');
    const meta2 = await this.oidc.discover(found.connection.issuer).catch(() => {
      throw new SsoLoginError('provider');
    });
    const attempt = this.oidc.newAttempt();
    const sealed: Attempt = {
      s: attempt.state,
      n: attempt.nonce,
      v: attempt.verifier,
      t: found.connection.tenantId,
      x: safeNext(next),
      e: Date.now() + ATTEMPT_MINUTES * 60_000,
    };
    return {
      url: this.oidc.authorizeUrl(meta2, {
        clientId: found.connection.clientId,
        redirectUri: this.redirectUri,
        state: attempt.state,
        nonce: attempt.nonce,
        challenge: attempt.challenge,
        loginHint: normalizeEmail(email),
      }),
      cookie: this.box.encrypt(JSON.stringify(sealed), 'sso-attempt'),
      maxAgeMs: ATTEMPT_MINUTES * 60_000,
    };
  }

  /** Finishes a sign-in. Any problem comes back as a short code, never as provider detail. */
  async complete(
    query: { code?: string | undefined; state?: string | undefined; error?: string | undefined },
    cookie: string | undefined,
    meta: RequestMeta,
  ): Promise<{ issued: IssuedSession; next: string }> {
    await this.limiter.consume('sso-callback-ip', meta.ip ?? 'unknown', this.env.AUTH_RATE_LIMIT_LOGIN_PER_IP, 60);
    let attempt: Attempt;
    try {
      attempt = JSON.parse(this.box.decrypt(cookie ?? '', 'sso-attempt')) as Attempt;
    } catch {
      throw new SsoLoginError('expired');
    }
    if (attempt.e < Date.now() || !query.state || query.state !== attempt.s) throw new SsoLoginError('expired');
    if (query.error || !query.code) {
      await this.fail(attempt.t, null, 'provider_denied', meta);
      throw new SsoLoginError('denied');
    }

    const connection = await withContext(this.db, { tenantId: attempt.t }, (tx) =>
      tx.ssoConnection.findUnique({ where: { tenantId: attempt.t } }),
    );
    if (!connection?.enabled) throw new SsoLoginError('unavailable');

    let identity;
    try {
      identity = await this.oidc.completeLogin(connection.issuer, {
        clientId: connection.clientId,
        clientSecret: this.box.decrypt(connection.clientSecretSealed, SsoService.secretAad(attempt.t)),
        redirectUri: this.redirectUri,
        code: query.code,
        verifier: attempt.v,
        nonce: attempt.n,
      });
    } catch {
      await this.fail(attempt.t, null, 'provider_error', meta);
      throw new SsoLoginError('provider');
    }

    const email = normalizeEmail(identity.email);
    if (connection.requireVerifiedEmail && !identity.emailVerified) {
      await this.fail(attempt.t, email, 'email_not_verified', meta);
      throw new SsoLoginError('unverified_email');
    }
    if (!connection.allowedDomains.includes(email.split('@')[1] ?? '')) {
      await this.fail(attempt.t, email, 'domain_not_allowed', meta);
      throw new SsoLoginError('wrong_domain');
    }
    const user = await this.db.user.findUnique({ where: { email } });
    const membership =
      user && user.status === 'ACTIVE' && !user.isPlatformAdmin
        ? await withContext(this.db, { userId: user.id }, (tx) =>
            tx.tenantMembership.findFirst({
              where: {
                userId: user.id,
                tenantId: attempt.t,
                status: 'ACTIVE',
                tenant: { status: { in: ['ACTIVE', 'OFFBOARDING'] } },
              },
              select: { id: true },
            }),
          )
        : null;
    // Signing in never creates an account or a membership: an administrator adds people first.
    if (!user || !membership) {
      await this.fail(attempt.t, email, 'no_membership', meta);
      throw new SsoLoginError('no_access');
    }

    const issued = await this.sessions.create(
      user.id,
      { mfaPending: false, activeTenantId: attempt.t, ssoTenantId: attempt.t, reauthenticated: false },
      meta,
    );
    await this.db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await withContext(this.db, { tenantId: attempt.t, userId: user.id }, (tx) =>
      tx.ssoConnection.update({ where: { tenantId: attempt.t }, data: { lastLoginAt: new Date() } }),
    );
    await this.audit.record(
      {
        action: 'auth.login.sso',
        outcome: 'SUCCESS',
        tenantId: attempt.t,
        actorUserId: user.id,
        targetType: 'session',
        targetId: issued.session.id,
      },
      meta,
    );
    return { issued, next: attempt.x };
  }

  private fail(tenantId: string, email: string | null, reason: string, meta: RequestMeta) {
    return this.audit.record(
      {
        action: 'auth.login.sso',
        outcome: 'FAILURE',
        tenantId,
        metadata: { reason, ...(email ? { emailFingerprint: emailFingerprint(email) } : {}) },
      },
      meta,
    );
  }
}

/** Only paths inside the web app, so the sign-in cannot be used to bounce someone to another site. */
export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\') || /[\r\n]/.test(next)) {
    return '/';
  }
  return next;
}
