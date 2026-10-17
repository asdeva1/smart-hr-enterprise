import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { NotificationJob, type EmailJobData } from '@smart-hr/shared';
import type { Job } from 'bullmq';
import type { Transporter } from 'nodemailer';
import type { WorkerEnv } from '../config/env.js';
import { MAIL_TRANSPORT, NOTIFICATIONS_QUEUE, WORKER_ENV } from '../queues.js';
import { EscalationService } from './escalation.service.js';
import { OutboxService, type OutboxSweepResult } from './outbox.service.js';
import { DocumentSweepService, type DocumentSweepResult } from './document-sweep.service.js';
import { SubscriptionExpiryService } from './subscription-expiry.service.js';

export interface EmailResult {
  delivered: boolean;
}

/**
 * Delivers queued emails. Failures throw, so BullMQ retries them with backoff and finally keeps them
 * in the failed set, where the failed-jobs dashboard (Phase 18) shows them.
 * Logs carry the job id and category only — never addresses or message content.
 */
@Processor(NOTIFICATIONS_QUEUE, { concurrency: 5 })
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: Transporter | null,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    private readonly outbox: OutboxService,
    private readonly escalation: EscalationService,
    private readonly subscriptions: SubscriptionExpiryService,
    private readonly documents: DocumentSweepService,
  ) {
    super();
  }

  async process(
    job: Job,
  ): Promise<
    EmailResult | OutboxSweepResult | DocumentSweepResult | { escalated: number } | { expired: number }
  > {
    switch (job.name) {
      case NotificationJob.Email:
        return this.sendEmail(job as Job<EmailJobData>);
      case NotificationJob.OutboxSweep:
        return this.outbox.sweep();
      case NotificationJob.EscalationSweep:
        return this.escalation.sweep();
      case NotificationJob.SubscriptionExpirySweep:
        return this.subscriptions.sweep();
      case NotificationJob.DocumentSweep:
        return this.documents.sweep();
      default:
        throw new Error(`Unknown notification job: ${job.name}`);
    }
  }

  private async sendEmail(job: Job<EmailJobData>): Promise<EmailResult> {
    const { to, subject, text, html, category } = job.data;
    if (!this.transport) {
      this.logger.warn(`Email delivery is not configured; ${category} email ${job.id} was not sent`);
      return { delivered: false };
    }
    await this.transport.sendMail({ from: this.env.MAIL_FROM, to, subject, text, ...(html ? { html } : {}) });
    this.logger.log(`Delivered ${category} email ${job.id}`);
    return { delivered: true };
  }
}
