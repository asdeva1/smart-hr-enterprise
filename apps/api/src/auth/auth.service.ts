import { Inject, Injectable } from '@nestjs/common';
import {
  checkPasswordPolicy,
  createTotpEnrolment,
  generateRecoveryCodes,
  generateToken,
  hashPassword,
  hashRecoveryCode,
  hashToken,
  needsRehash,
  normalizeEmail,
  PASSWORD_PROBLEM_MESSAGES,
  SecretBox,
  verifyAgainstDummy,
  verifyPassword,
  verifyTotp,
} from '@smart-hr/auth';
import { withContext, type DatabaseClient, type User, type UserSession } from '@smart-hr/database';
import { AppError, NotFoundError } from '@smart-hr/shared';
import type {
  ChangePasswordInput,
  LoginInput,
  MfaVerifyInput,
  ReauthenticateInput,
  ResetPasswordInput,
} from '@smart-hr/validation';
import { AuditService, emailFingerprint } from '../audit/audit.service.js';
import type { RequestMeta } from '../common/request-context.js';
import type { ApiEnv } from '../config/env.js';
import { API_ENV, DATABASE } from '../infra/tokens.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { MailService } from '../notifications/mail.service.js';
import { ASSIGNMENT_SELECT, permissionSetFrom } from '../rbac/rbac.service.js';
import type { AuthContext, SessionView } from './auth.types.js';
import { OneTimeCodeService } from './one-time-code.service.js';
import { RateLimiterService } from './rate-limiter.service.js';
import { SessionService, type IssuedSession } from './session.service.js';

/** One message for every sign-in failure, so responses never reveal whether an account exists or why it failed. */
export const INVALID_CREDENTIALS_MESSAGE =
  'We couldn’t sign you in with those details. After several attempts the account is locked for a short time.';

class InvalidCredentialsError extends AppError {
  constructor() {
    super('INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE, 401);
  }
}

/** Pending second-factor sessions live only briefly. */
const MFA_PENDING_MINUTES = 5;

@Injectable()
export class AuthService {
  private readonly secrets: SecretBox;

  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly sessions: SessionService,
    private readonly limiter: RateLimiterService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly entitlements: EntitlementsService,
    private readonly codes: OneTimeCodeService,
  ) {
    this.secrets = new SecretBox(env.MFA_ENCRYPTION_KEYS, env.MFA_ENCRYPTION_KEY_ID);
  }

  // ---------------------------------------------------------------- sign-in

  async login(input: LoginInput, meta: RequestMeta): Promise<IssuedSession> {
    const email = normalizeEmail(input.email);
    await this.limiter.consume('login-ip', meta.ip ?? 'unknown', this.env.AUTH_RATE_LIMIT_LOGIN_PER_IP, 60);
    await this.limiter.consume('login-email', email, this.env.AUTH_RATE_LIMIT_LOGIN_PER_EMAIL, 15 * 60);

    const user = await this.db.user.findUnique({ where: { email } });
    if (!user?.passwordHash) {
      await verifyAgainstDummy(input.password);
      await this.audit.record(
        {
          action: 'auth.login',
          outcome: 'FAILURE',
          metadata: { reason: 'unknown_account', emailFingerprint: emailFingerprint(email) },
        },
        meta,
      );
      throw new InvalidCredentialsError();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await verifyAgainstDummy(input.password);
      await this.audit.record(
        { action: 'auth.login', outcome: 'DENIED', actorUserId: user.id, metadata: { reason: 'locked' } },
        meta,
      );
      throw new InvalidCredentialsError();
    }

    if (!(await verifyPassword(user.passwordHash, input.password))) {
      await this.registerFailure(user, 'bad_password', meta);
      throw new InvalidCredentialsError();
    }

    if (user.status !== 'ACTIVE') {
      await this.audit.record(
        { action: 'auth.login', outcome: 'DENIED', actorUserId: user.id, metadata: { reason: 'disabled' } },
        meta,
      );
      throw new InvalidCredentialsError();
    }

    await this.db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        ...(needsRehash(user.passwordHash) ? { passwordHash: await hashPassword(input.password) } : {}),
      },
    });
    await this.limiter.reset('login-email', email);

    const mfaPending = user.mfaEnabledAt !== null;
    const issued = await this.sessions.create(
      user.id,
      {
        mfaPending,
        activeTenantId: mfaPending ? null : await this.defaultTenant(user.id),
        reauthenticated: !mfaPending && !this.env.REAUTH_EMAIL_CODE_REQUIRED,
        ...(mfaPending ? { idleMinutes: MFA_PENDING_MINUTES } : {}),
      },
      meta,
    );
    await this.audit.record(
      {
        action: mfaPending ? 'auth.login.password_verified' : 'auth.login',
        outcome: 'SUCCESS',
        actorUserId: user.id,
        targetType: 'session',
        targetId: issued.session.id,
      },
      meta,
    );
    return issued;
  }

  /** Counts a failed password or code, locking the account when the threshold is reached. */
  private async registerFailure(user: User, reason: string, meta: RequestMeta): Promise<void> {
    const failures = user.failedLoginCount + 1;
    const lock = failures >= this.env.AUTH_LOCKOUT_THRESHOLD;
    await this.db.user.update({
      where: { id: user.id },
      data: lock
        ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + this.env.AUTH_LOCKOUT_MINUTES * 60_000) }
        : { failedLoginCount: failures },
    });
    await this.audit.record(
      { action: 'auth.login', outcome: 'FAILURE', actorUserId: user.id, metadata: { reason, failures } },
      meta,
    );
    if (lock) {
      await this.sessions.revokeAllForUser(user.id, 'account_locked');
      await this.audit.record(
        {
          action: 'auth.account.locked',
          outcome: 'SUCCESS',
          actorUserId: user.id,
          targetType: 'user',
          targetId: user.id,
          metadata: { minutes: this.env.AUTH_LOCKOUT_MINUTES },
        },
        meta,
      );
    }
  }

  /** The user's only tenant, if they have exactly one; otherwise they choose after sign-in. */
  private async defaultTenant(userId: string): Promise<string | null> {
    const memberships = await this.activeMemberships(userId);
    return memberships.length === 1 ? memberships[0]!.tenantId : null;
  }

  private async activeMemberships(userId: string) {
    return withContext(this.db, { userId }, (tx) =>
      tx.tenantMembership.findMany({
        // Offboarding organisations stay reachable, read-only, so members can export their data.
        where: { userId, status: 'ACTIVE', tenant: { status: { in: ['ACTIVE', 'OFFBOARDING'] } } },
        include: {
          tenant: {
            select: {
              id: true,
              name: true,
              status: true,
              brandName: true,
              brandColor: true,
              brandLogoUrl: true,
            },
          },
        },
        orderBy: { tenant: { name: 'asc' } },
      }),
    );
  }

  async verifyMfa(auth: AuthContext, input: MfaVerifyInput, meta: RequestMeta): Promise<IssuedSession> {
    const { session, user } = auth;
    if (!session.mfaPending) throw new AppError('MFA_NOT_PENDING', 'No second factor is required', 409);
    await this.limiter.consume('mfa-session', session.id, 5, 5 * 60);

    const ok = await this.checkSecondFactor(user, input);
    if (!ok) {
      await this.registerFailure(user, 'bad_second_factor', meta);
      throw new AppError(
        'INVALID_CODE',
        'That code is not valid. Check your authenticator app and try again.',
        401,
      );
    }

    await this.db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0 } });
    const issued = await this.sessions.rotate(session.id, {
      mfaPending: false,
      activeTenantId: await this.defaultTenant(user.id),
      reauthenticatedAt: new Date(),
    });
    await this.audit.record(
      {
        action: 'auth.login',
        outcome: 'SUCCESS',
        actorUserId: user.id,
        targetType: 'session',
        targetId: session.id,
        metadata: { secondFactor: 'recoveryCode' in input ? 'recovery_code' : 'totp' },
      },
      meta,
    );
    return issued;
  }

  /** Checks a TOTP or recovery code and consumes it (TOTP step recorded, recovery code marked used). */
  private async checkSecondFactor(
    user: User,
    input: { code?: string; recoveryCode?: string },
  ): Promise<boolean> {
    if (!user.mfaTotpSecret) return false;
    if (input.code) {
      const secret = this.secrets.decrypt(user.mfaTotpSecret, user.id);
      const lastStep = user.mfaTotpLastStep === null ? null : Number(user.mfaTotpLastStep);
      const check = verifyTotp(secret, input.code, lastStep);
      if (!check.valid || check.step === undefined) return false;
      // Conditional update: two concurrent requests with the same code cannot both succeed.
      const updated = await this.db.user.updateMany({
        where: {
          id: user.id,
          OR: [{ mfaTotpLastStep: null }, { mfaTotpLastStep: { lt: BigInt(check.step) } }],
        },
        data: { mfaTotpLastStep: BigInt(check.step) },
      });
      return updated.count === 1;
    }
    if (input.recoveryCode) {
      const used = await this.db.mfaRecoveryCode.updateMany({
        where: { userId: user.id, codeHash: hashRecoveryCode(input.recoveryCode), usedAt: null },
        data: { usedAt: new Date() },
      });
      return used.count === 1;
    }
    return false;
  }

  // ---------------------------------------------------------------- session

  async logout(auth: AuthContext, meta: RequestMeta): Promise<void> {
    await this.sessions.revoke(auth.session.id, 'logout');
    await this.audit.record(
      {
        action: 'auth.logout',
        outcome: 'SUCCESS',
        actorUserId: auth.user.id,
        targetType: 'session',
        targetId: auth.session.id,
      },
      meta,
    );
  }

  async logoutAll(auth: AuthContext, meta: RequestMeta): Promise<number> {
    const count = await this.sessions.revokeAllForUser(auth.user.id, 'logout_all');
    await this.audit.record(
      {
        action: 'auth.sessions.revoke_all',
        outcome: 'SUCCESS',
        actorUserId: auth.user.id,
        metadata: { count },
      },
      meta,
    );
    return count;
  }

  async view(session: UserSession, user: User): Promise<SessionView> {
    const memberships = session.mfaPending ? [] : await this.activeMemberships(user.id);
    const active = memberships.find((m) => m.tenantId === session.activeTenantId);
    const activeDetail = active
      ? await withContext(this.db, { tenantId: active.tenantId, userId: user.id }, async (tx) => ({
          membership: await tx.tenantMembership.findUnique({
            where: { id: active.id },
            select: { tenant: { select: { requireMfa: true } }, assignments: { select: ASSIGNMENT_SELECT } },
          }),
          entitlements: await this.entitlements.forTenant(tx),
        }))
      : null;
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        isPlatformAdmin: user.isPlatformAdmin,
        mfaEnabled: user.mfaEnabledAt !== null,
        reauthEmailCode: this.env.REAUTH_EMAIL_CODE_REQUIRED && user.mfaEnabledAt === null,
      },
      mfaPending: session.mfaPending,
      activeTenant:
        active && activeDetail?.membership
          ? {
              id: active.tenantId,
              name: active.tenant.name,
              isTenantAdmin: active.isTenantAdmin,
              permissions: permissionSetFrom(
                active.tenantId,
                active.isTenantAdmin,
                activeDetail.membership.assignments,
              ).codes(),
              mfaEnrolmentRequired: activeDetail.membership.tenant.requireMfa && user.mfaEnabledAt === null,
              status: active.tenant.status === 'OFFBOARDING' ? 'OFFBOARDING' : 'ACTIVE',
              branding: {
                name: active.tenant.brandName,
                color: active.tenant.brandColor,
                logoUrl: active.tenant.brandLogoUrl,
              },
              plan: {
                code: activeDetail.entitlements.plan?.code ?? null,
                name: activeDetail.entitlements.plan?.name ?? null,
                status: activeDetail.entitlements.status,
                access: activeDetail.entitlements.access,
                features: activeDetail.entitlements.features,
                graceEndsAt: activeDetail.entitlements.graceEndsAt,
                trialEndsAt: activeDetail.entitlements.trialEndsAt,
              },
            }
          : null,
      memberships: memberships.map((m) => ({
        tenantId: m.tenantId,
        name: m.tenant.name,
        isTenantAdmin: m.isTenantAdmin,
      })),
      deploymentMode: this.env.DEPLOYMENT_MODE,
      expiresAt: (session.idleExpiresAt < session.absoluteExpiresAt
        ? session.idleExpiresAt
        : session.absoluteExpiresAt
      ).toISOString(),
      absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
    };
  }

  /** Switches the active tenant after re-checking membership. The client's choice is a request, not proof. */
  async switchTenant(auth: AuthContext, tenantId: string, meta: RequestMeta): Promise<IssuedSession> {
    const membership = (await this.activeMemberships(auth.user.id)).find((m) => m.tenantId === tenantId);
    if (!membership) {
      await this.audit.record(
        {
          action: 'auth.tenant.switch',
          outcome: 'DENIED',
          actorUserId: auth.user.id,
          targetType: 'tenant',
          targetId: tenantId,
        },
        meta,
      );
      throw new AppError('FORBIDDEN', 'You do not have access to that organisation', 403);
    }
    const issued = await this.sessions.rotate(auth.session.id, { activeTenantId: tenantId });
    await this.audit.record(
      {
        action: 'auth.tenant.switch',
        outcome: 'SUCCESS',
        tenantId,
        actorUserId: auth.user.id,
        targetType: 'tenant',
        targetId: tenantId,
      },
      meta,
    );
    return issued;
  }

  async listSessions(auth: AuthContext) {
    const sessions = await this.sessions.listActive(auth.user.id);
    return sessions.map((s) => ({
      id: s.id,
      current: s.id === auth.session.id,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
    }));
  }

  /** Revokes one of the caller's own sessions. Another user's session id gives the same 404 as a missing one. */
  async revokeSession(auth: AuthContext, sessionId: string, meta: RequestMeta): Promise<void> {
    const target = await this.db.userSession.findFirst({
      where: { id: sessionId, userId: auth.user.id, revokedAt: null },
    });
    if (!target) throw new NotFoundError('Session');
    await this.sessions.revoke(target.id, 'revoked_by_user');
    await this.audit.record(
      {
        action: 'auth.session.revoke',
        outcome: 'SUCCESS',
        actorUserId: auth.user.id,
        targetType: 'session',
        targetId: target.id,
      },
      meta,
    );
  }

  async recentSecurityEvents(auth: AuthContext) {
    const events = await withContext(this.db, { userId: auth.user.id }, (tx) =>
      tx.auditEvent.findMany({
        where: { actorUserId: auth.user.id, tenantId: null, action: { startsWith: 'auth.' } },
        orderBy: { occurredAt: 'desc' },
        take: 20,
      }),
    );
    return events.map((e) => ({
      action: e.action,
      outcome: e.outcome,
      occurredAt: e.occurredAt.toISOString(),
      ipAddress: e.ipAddress,
      userAgent: e.userAgent,
    }));
  }

  // ---------------------------------------------------------------- passwords

  private assertPolicy(password: string, email: string): void {
    const problems = checkPasswordPolicy(password, { email });
    if (problems.length > 0) {
      throw new AppError(
        'WEAK_PASSWORD',
        'Choose a stronger password',
        400,
        problems.map((p) => ({ path: 'newPassword', message: PASSWORD_PROBLEM_MESSAGES[p] })),
      );
    }
  }

  /** Always succeeds from the caller's point of view, whether or not the account exists. */
  async forgotPassword(rawEmail: string, meta: RequestMeta): Promise<void> {
    const email = normalizeEmail(rawEmail);
    await this.limiter.consume(
      'reset-ip',
      meta.ip ?? 'unknown',
      this.env.AUTH_RATE_LIMIT_RESET_PER_IP,
      60 * 60,
    );
    try {
      await this.limiter.consume('reset-email', email, this.env.AUTH_RATE_LIMIT_RESET_PER_EMAIL, 60 * 60);
    } catch {
      // Too many requests for this address: stay silent rather than reveal anything.
      return;
    }

    const user = await this.db.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') {
      await this.audit.record(
        {
          action: 'auth.password.reset_requested',
          outcome: 'FAILURE',
          metadata: { reason: 'no_active_account', emailFingerprint: emailFingerprint(email) },
        },
        meta,
      );
      return;
    }

    const token = generateToken();
    await this.db.$transaction([
      // Only the newest link works.
      this.db.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.db.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + this.env.PASSWORD_RESET_TTL_MINUTES * 60_000),
        },
      }),
    ]);

    const link = new URL('/reset-password', this.env.APP_PUBLIC_URL);
    link.searchParams.set('token', token);
    await this.mail.send({
      to: user.email,
      category: 'password_reset',
      subject: 'Reset your Smart HR password',
      text: [
        `Hello ${user.displayName},`,
        '',
        'Someone asked to reset the password for your Smart HR account.',
        `To choose a new password, open this link within ${this.env.PASSWORD_RESET_TTL_MINUTES} minutes:`,
        '',
        link.toString(),
        '',
        'If this wasn’t you, ignore this email; your password stays the same.',
      ].join('\n'),
    });
    await this.audit.record(
      {
        action: 'auth.password.reset_requested',
        outcome: 'SUCCESS',
        actorUserId: user.id,
        targetType: 'user',
        targetId: user.id,
      },
      meta,
    );
  }

  async resetPassword(input: ResetPasswordInput, meta: RequestMeta): Promise<void> {
    const invalid = new AppError(
      'RESET_TOKEN_INVALID',
      'This reset link is invalid or has expired. Request a new one.',
      400,
    );
    const record = await this.db.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(input.token) },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt <= new Date() || record.user.status !== 'ACTIVE') {
      await this.audit.record(
        {
          action: 'auth.password.reset',
          outcome: 'FAILURE',
          actorUserId: record?.userId ?? null,
          metadata: { reason: 'invalid_token' },
        },
        meta,
      );
      throw invalid;
    }
    this.assertPolicy(input.newPassword, record.user.email);

    // Claim the token atomically: if two requests race, only one sets the password.
    const claimed = await this.db.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw invalid;

    await this.db.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: await hashPassword(input.newPassword),
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    const revoked = await this.sessions.revokeAllForUser(record.userId, 'password_reset');
    await this.audit.record(
      {
        action: 'auth.password.reset',
        outcome: 'SUCCESS',
        actorUserId: record.userId,
        targetType: 'user',
        targetId: record.userId,
        metadata: { sessionsRevoked: revoked },
      },
      meta,
    );
  }

  async changePassword(
    auth: AuthContext,
    input: ChangePasswordInput,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const { user } = auth;
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
      await this.registerFailure(user, 'bad_current_password', meta);
      throw new AppError('INVALID_CREDENTIALS', 'Your current password is incorrect', 401);
    }
    if (input.currentPassword === input.newPassword) {
      throw new AppError('WEAK_PASSWORD', 'Choose a password different from your current one', 400, [
        { path: 'newPassword', message: 'Must differ from your current password' },
      ]);
    }
    this.assertPolicy(input.newPassword, user.email);

    await this.db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(input.newPassword),
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
      },
    });
    const revoked = await this.sessions.revokeAllForUser(user.id, 'password_changed', auth.session.id);
    const issued = await this.sessions.rotate(auth.session.id, { reauthenticatedAt: new Date() });
    await this.audit.record(
      {
        action: 'auth.password.change',
        outcome: 'SUCCESS',
        actorUserId: user.id,
        targetType: 'user',
        targetId: user.id,
        metadata: { otherSessionsRevoked: revoked },
      },
      meta,
    );
    return issued;
  }

  /**
   * Emails a six-digit code for the next sensitive change. Used by people without an authenticator app; people
   * with one use the code from the app instead.
   */
  async sendReauthenticationCode(auth: AuthContext, meta: RequestMeta): Promise<void> {
    const { user, session } = auth;
    if (!this.env.REAUTH_EMAIL_CODE_REQUIRED || user.mfaEnabledAt !== null) {
      throw new AppError('NOT_NEEDED', 'Use the code from your authenticator app.', 409);
    }
    await this.limiter.consume('reauth-code-session', session.id, 3, 10 * 60);
    await this.limiter.consume('reauth-code-user', user.id, 6, 60 * 60);
    const code = await this.codes.issue(session.id, this.env.REAUTH_EMAIL_CODE_TTL_MINUTES);
    await this.mail.send({
      to: user.email,
      category: 'reauth_code',
      subject: 'Your Smart HR confirmation code',
      text: [
        `Hello ${user.displayName},`,
        '',
        `Your confirmation code is ${code}`,
        '',
        `It works once and expires in ${this.env.REAUTH_EMAIL_CODE_TTL_MINUTES} minutes. Someone asked to change settings in your organisation.`,
        'If this was not you, do not share the code; change your password instead.',
      ].join('\n'),
    });
    await this.audit.record(
      { action: 'auth.reauthenticate.code_sent', outcome: 'SUCCESS', actorUserId: user.id },
      meta,
    );
  }

  /** Confirms identity again before sensitive changes (MFA setup or removal, organisation settings, exports). */
  async reauthenticate(auth: AuthContext, input: ReauthenticateInput, meta: RequestMeta): Promise<void> {
    const { user, session } = auth;
    await this.limiter.consume('reauth-session', session.id, 5, 5 * 60);
    const passwordOk = !!user.passwordHash && (await verifyPassword(user.passwordHash, input.password));
    const needsEmailCode = this.env.REAUTH_EMAIL_CODE_REQUIRED && user.mfaEnabledAt === null;
    // A wrong password must not use up the emailed code, so the code is checked only after the password.
    const factorOk = needsEmailCode
      ? passwordOk && (await this.codes.verify(session.id, input.emailCode ?? ''))
      : user.mfaEnabledAt === null || (await this.checkSecondFactor(user, { code: input.code ?? '' }));
    if (!passwordOk || !factorOk) {
      await this.registerFailure(user, 'bad_reauthentication', meta);
      throw new AppError(
        'INVALID_CREDENTIALS',
        needsEmailCode
          ? 'Your password or the emailed code is incorrect, or the code has expired'
          : user.mfaEnabledAt
            ? 'Your password or authenticator code is incorrect'
            : 'Your password is incorrect',
        401,
      );
    }
    await this.sessions.markReauthenticated(session.id);
    await this.audit.record(
      { action: 'auth.reauthenticate', outcome: 'SUCCESS', actorUserId: user.id },
      meta,
    );
  }

  // ---------------------------------------------------------------- MFA

  async startTotpEnrolment(auth: AuthContext, meta: RequestMeta): Promise<{ secret: string; uri: string }> {
    const { user } = auth;
    if (user.mfaEnabledAt)
      throw new AppError('MFA_ALREADY_ENABLED', 'Two-step verification is already on', 409);
    const enrolment = createTotpEnrolment(this.env.MFA_ISSUER, user.email);
    await this.db.user.update({
      where: { id: user.id },
      data: { mfaTotpPendingSecret: this.secrets.encrypt(enrolment.secret, user.id) },
    });
    await this.audit.record(
      { action: 'auth.mfa.enrolment_started', outcome: 'SUCCESS', actorUserId: user.id },
      meta,
    );
    return enrolment;
  }

  async confirmTotpEnrolment(auth: AuthContext, code: string, meta: RequestMeta): Promise<string[]> {
    const fresh = await this.db.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (fresh.mfaEnabledAt)
      throw new AppError('MFA_ALREADY_ENABLED', 'Two-step verification is already on', 409);
    if (!fresh.mfaTotpPendingSecret) throw new AppError('MFA_NOT_STARTED', 'Start setup again', 409);

    const secret = this.secrets.decrypt(fresh.mfaTotpPendingSecret, fresh.id);
    const check = verifyTotp(secret, code, null);
    if (!check.valid || check.step === undefined) {
      await this.audit.record({ action: 'auth.mfa.enable', outcome: 'FAILURE', actorUserId: fresh.id }, meta);
      throw new AppError(
        'INVALID_CODE',
        'That code is not valid. Check the time on your phone and try again.',
        400,
      );
    }

    const codes = generateRecoveryCodes();
    await this.db.$transaction([
      this.db.user.update({
        where: { id: fresh.id },
        data: {
          mfaTotpSecret: fresh.mfaTotpPendingSecret,
          mfaTotpPendingSecret: null,
          mfaTotpLastStep: BigInt(check.step),
          mfaEnabledAt: new Date(),
        },
      }),
      this.db.mfaRecoveryCode.deleteMany({ where: { userId: fresh.id } }),
      this.db.mfaRecoveryCode.createMany({
        data: codes.map((c) => ({ userId: fresh.id, codeHash: hashRecoveryCode(c) })),
      }),
    ]);
    await this.sessions.revokeAllForUser(fresh.id, 'mfa_enabled', auth.session.id);
    await this.audit.record(
      { action: 'auth.mfa.enable', outcome: 'SUCCESS', actorUserId: fresh.id, metadata: { method: 'totp' } },
      meta,
    );
    return codes;
  }

  async regenerateRecoveryCodes(auth: AuthContext, meta: RequestMeta): Promise<string[]> {
    if (!auth.user.mfaEnabledAt)
      throw new AppError('MFA_NOT_ENABLED', 'Turn on two-step verification first', 409);
    const codes = generateRecoveryCodes();
    await this.db.$transaction([
      this.db.mfaRecoveryCode.deleteMany({ where: { userId: auth.user.id } }),
      this.db.mfaRecoveryCode.createMany({
        data: codes.map((c) => ({ userId: auth.user.id, codeHash: hashRecoveryCode(c) })),
      }),
    ]);
    await this.audit.record(
      { action: 'auth.mfa.recovery_codes_regenerated', outcome: 'SUCCESS', actorUserId: auth.user.id },
      meta,
    );
    return codes;
  }

  async disableTotp(auth: AuthContext, meta: RequestMeta): Promise<void> {
    if (!auth.user.mfaEnabledAt)
      throw new AppError('MFA_NOT_ENABLED', 'Two-step verification is not on', 409);
    await this.db.$transaction([
      this.db.user.update({
        where: { id: auth.user.id },
        data: { mfaTotpSecret: null, mfaTotpPendingSecret: null, mfaTotpLastStep: null, mfaEnabledAt: null },
      }),
      this.db.mfaRecoveryCode.deleteMany({ where: { userId: auth.user.id } }),
    ]);
    await this.sessions.revokeAllForUser(auth.user.id, 'mfa_disabled', auth.session.id);
    await this.audit.record(
      { action: 'auth.mfa.disable', outcome: 'SUCCESS', actorUserId: auth.user.id },
      meta,
    );
  }
}
