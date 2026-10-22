import { Inject, Injectable } from '@nestjs/common';
import { normalizeEmail } from '@smart-hr/auth';
import { NotFoundError } from '@smart-hr/shared';
import type { contactSalesSchema } from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService, emailFingerprint } from '../audit/audit.service.js';
import { RateLimiterService } from '../auth/rate-limiter.service.js';
import type { RequestMeta } from '../common/request-context.js';
import type { ApiEnv } from '../config/env.js';
import { API_ENV } from '../infra/tokens.js';
import { MailService } from '../notifications/mail.service.js';

/** One line, so a pasted newline can't add headers or fake extra lines to the email we send. */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();

/**
 * "Contact us" from the website: the message goes to the sales inbox and nothing is stored here. The visitor
 * gets the same answer whatever they type, and the sender's address is only ever used as a reply-to line.
 */
@Injectable()
export class ContactService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly limiter: RateLimiterService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  async submit(input: z.output<typeof contactSalesSchema>, meta: RequestMeta): Promise<void> {
    if (!this.env.SALES_CONTACT_EMAIL) throw new NotFoundError('Page');
    const email = normalizeEmail(input.email);
    await this.limiter.consume('contact-ip', meta.ip ?? 'unknown', this.env.SIGNUP_RATE_LIMIT_PER_IP, 3600);
    await this.limiter.consume('contact-email', email, this.env.SIGNUP_RATE_LIMIT_PER_EMAIL * 2, 3600);

    await this.mail.send({
      to: this.env.SALES_CONTACT_EMAIL,
      category: 'sales_enquiry',
      subject: `Website enquiry: ${oneLine(input.company)} (${input.interest.toLowerCase()})`,
      text: [
        `Name: ${oneLine(input.name)}`,
        `Email: ${email}`,
        `Company: ${oneLine(input.company)}`,
        `Phone: ${input.phone ? oneLine(input.phone) : '-'}`,
        `Employees: ${input.employees ?? '-'}`,
        `Interested in: ${input.interest}`,
        '',
        input.message ?? '(no message)',
      ].join('\n'),
    });
    await this.audit.record(
      {
        action: 'contact.sales',
        outcome: 'SUCCESS',
        metadata: { email: emailFingerprint(email), interest: input.interest },
      },
      meta,
    );
  }
}
