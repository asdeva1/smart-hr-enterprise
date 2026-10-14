import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  checkPasswordPolicy,
  generateToken,
  hashPassword,
  hashToken,
  normalizeEmail,
  PASSWORD_PROBLEM_MESSAGES,
} from '@smart-hr/auth';
import { withContext, type DatabaseClient } from '@smart-hr/database';
import { AppError, NotFoundError } from '@smart-hr/shared';
import type { completeSignupSchema, signupSchema } from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService, emailFingerprint } from '../audit/audit.service.js';
import { RateLimiterService } from '../auth/rate-limiter.service.js';
import type { RequestMeta } from '../common/request-context.js';
import type { ApiEnv } from '../config/env.js';
import { latestPublishedVersion } from '../entitlements/catalogue-sync.js';
import { TenantProvisioner } from '../identity/tenant-provisioner.js';
import { API_ENV, DATABASE } from '../infra/tokens.js';
import { MailService } from '../notifications/mail.service.js';

/** A URL-safe address for a new organisation: its name, plus a random suffix so names can repeat. */
export function slugFor(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'org'}-${randomBytes(3).toString('hex')}`;
}

/**
 * Self-service sign-up for the multi-tenant SaaS. Two steps, so nothing is created for an address nobody
 * controls: (1) request → an emailed link; (2) open the link and choose a password → the person's account,
 * a new organisation they own, and a trial of SIGNUP_PLAN, in one transaction.
 *
 * The first step answers the same way whether or not the address already has an account, so it can't be used
 * to find out who uses Smart HR. Disabled unless SIGNUP_ENABLED=true.
 */
@Injectable()
export class SignupService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly limiter: RateLimiterService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly provisioner: TenantProvisioner,
  ) {}

  private requireEnabled() {
    if (!this.env.SIGNUP_ENABLED) throw new NotFoundError('Page');
  }

  async request(input: z.output<typeof signupSchema>, meta: RequestMeta): Promise<void> {
    this.requireEnabled();
    const email = normalizeEmail(input.email);
    await this.limiter.consume('signup-ip', meta.ip ?? 'unknown', this.env.SIGNUP_RATE_LIMIT_PER_IP, 60 * 60);
    await this.limiter.consume('signup-email', email, this.env.SIGNUP_RATE_LIMIT_PER_EMAIL, 60 * 60);

    const existing = await this.db.user.findUnique({ where: { email }, select: { passwordHash: true } });
    if (existing?.passwordHash) {
      await this.mail.send({
        to: email,
        category: 'signup_existing_account',
        subject: 'You already have a Smart HR account',
        text: [
          `Hello ${input.displayName},`,
          '',
          'Someone (hopefully you) tried to sign up for Smart HR with this address, which already has an account.',
          `Sign in instead: ${new URL('/login', this.env.APP_PUBLIC_URL).toString()}`,
          '',
          'If this wasn’t you, you can ignore this email.',
        ].join('\n'),
      });
    } else {
      const token = generateToken();
      await withContext(this.db, { platformActor: true }, (tx) =>
        tx.signupRequest.create({
          data: {
            email,
            displayName: input.displayName,
            organisationName: input.organisationName,
            tokenHash: hashToken(token),
            expiresAt: new Date(Date.now() + this.env.SIGNUP_TTL_HOURS * 3_600_000),
          },
        }),
      );
      const link = new URL('/signup/complete', this.env.APP_PUBLIC_URL);
      link.searchParams.set('token', token);
      await this.mail.send({
        to: email,
        category: 'signup',
        subject: `Finish setting up ${input.organisationName} on Smart HR`,
        text: [
          `Hello ${input.displayName},`,
          '',
          `Choose your password within ${this.env.SIGNUP_TTL_HOURS} hours to create ${input.organisationName} on Smart HR:`,
          '',
          link.toString(),
          '',
          'If you didn’t sign up, you can ignore this email; nothing has been created.',
        ].join('\n'),
      });
    }
    await this.audit.record(
      {
        action: 'signup.request',
        outcome: 'SUCCESS',
        metadata: { email: emailFingerprint(email), existingAccount: !!existing?.passwordHash },
      },
      meta,
    );
  }

  async complete(input: z.output<typeof completeSignupSchema>, meta: RequestMeta) {
    this.requireEnabled();
    const invalid = () =>
      new AppError(
        'SIGNUP_LINK_INVALID',
        'This link has expired or was already used. Please sign up again.',
        400,
      );
    const request = await withContext(this.db, { platformActor: true }, (tx) =>
      tx.signupRequest.findUnique({ where: { tokenHash: hashToken(input.token) } }),
    );
    if (!request || request.completedAt || request.expiresAt < new Date()) throw invalid();

    const problems = checkPasswordPolicy(input.password, { email: request.email });
    if (problems.length > 0) {
      throw new AppError(
        'PASSWORD_POLICY',
        'Choose a stronger password',
        422,
        problems.map((p) => ({ path: 'password', message: PASSWORD_PROBLEM_MESSAGES[p] })),
      );
    }
    const passwordHash = await hashPassword(input.password);

    const result = await withContext(this.db, { platformActor: true }, async (tx) => {
      // Claim the request first, so a double submit can't create two organisations.
      const claimed = await tx.signupRequest.updateMany({
        where: { id: request.id, completedAt: null },
        data: { completedAt: new Date() },
      });
      if (claimed.count === 0) throw invalid();
      const existing = await tx.user.findUnique({ where: { email: request.email } });
      if (existing?.passwordHash) {
        throw new AppError('ACCOUNT_EXISTS', 'This address already has an account. Sign in instead.', 409);
      }
      const user = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: { passwordHash, passwordChangedAt: new Date(), displayName: request.displayName },
          })
        : await tx.user.create({
            data: {
              email: request.email,
              displayName: request.displayName,
              passwordHash,
              passwordChangedAt: new Date(),
            },
          });
      const version = await latestPublishedVersion(tx, this.env.SIGNUP_PLAN);
      const { tenant } = await this.provisioner.create(tx, {
        name: request.organisationName,
        slug: slugFor(request.organisationName),
        ownerUserId: user.id,
        ...(version && version.trialDays > 0 ? { plan: { version, status: 'TRIAL' as const } } : {}),
        actorUserId: user.id,
        source: 'signup',
        meta,
      });
      await tx.signupRequest.update({ where: { id: request.id }, data: { tenantId: tenant.id } });
      return { email: user.email, organisation: tenant.name };
    });
    return result;
  }
}
