import { Inject, Injectable } from '@nestjs/common';
import { generateToken, hashToken } from '@smart-hr/auth';
import type { DatabaseClient } from '@smart-hr/database';
import type { ApiEnv } from '../config/env.js';
import { API_ENV, DATABASE } from '../infra/tokens.js';
import { MailService } from '../notifications/mail.service.js';

/**
 * Invitations to set a first password. Used when a member is invited, when an operator creates an organisation
 * for a new owner, and when an invitation is resent. Any earlier unused link for the person stops working.
 */
@Injectable()
export class InvitationService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly mail: MailService,
  ) {}

  async send(
    userId: string,
    email: string,
    displayName: string,
    tenantName: string,
    inviterName: string,
  ): Promise<void> {
    const token = generateToken();
    await this.db.$transaction([
      this.db.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.db.passwordResetToken.create({
        data: {
          userId,
          purpose: 'INVITATION',
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + this.env.INVITATION_TTL_HOURS * 3_600_000),
        },
      }),
    ]);
    const link = new URL('/reset-password', this.env.APP_PUBLIC_URL);
    link.searchParams.set('token', token);
    link.searchParams.set('invite', '1');
    await this.mail.send({
      to: email,
      category: 'invitation',
      subject: `${inviterName} invited you to ${tenantName} on Smart HR`,
      text: [
        `Hello ${displayName},`,
        '',
        `${inviterName} invited you to join ${tenantName} on Smart HR.`,
        `Choose your password within ${this.env.INVITATION_TTL_HOURS} hours to activate your account:`,
        '',
        link.toString(),
        '',
        'If you weren’t expecting this, you can ignore this email.',
      ].join('\n'),
    });
  }
}
