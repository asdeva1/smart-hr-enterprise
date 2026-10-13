import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DatabaseClient } from '@smart-hr/database';
import type { Transporter } from 'nodemailer';
import type { WorkerEnv } from '../config/env.js';
import { DATABASE, MAIL_TRANSPORT, WORKER_ENV } from '../queues.js';

interface ClaimedEmail {
  id: string;
  category: string;
  email_to: string | null;
  email_subject: string | null;
  email_text: string | null;
}

export interface OutboxSweepResult {
  claimed: number;
  sent: number;
  failed: number;
}

/** A claim older than this is assumed abandoned (the worker died mid-send) and is picked up again. */
const RECLAIM_AFTER_SECONDS = 300;
const BATCH = 50;

/**
 * Delivers emails written to the notification outbox by the API. Rows are claimed across tenants by a narrow
 * SECURITY DEFINER function (`FOR UPDATE SKIP LOCKED`), so several worker tasks never send the same email.
 * Each result is recorded straight away; a crash between send and record means at most one duplicate email.
 * Logs carry ids and categories only — never addresses or content.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(MAIL_TRANSPORT) private readonly transport: Transporter | null,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
  ) {}

  async sweep(): Promise<OutboxSweepResult> {
    // Without a transport, leave emails pending rather than burning their attempts.
    if (!this.transport) return { claimed: 0, sent: 0, failed: 0 };
    const transport = this.transport;
    const rows = await this.db.$queryRaw<ClaimedEmail[]>`
      SELECT * FROM claim_email_notifications(${BATCH}::int, ${RECLAIM_AFTER_SECONDS}::int)`;

    let sent = 0;
    let failed = 0;
    for (const row of rows) {
      let error: string | null = null;
      try {
        if (!row.email_to || !row.email_subject || row.email_text === null)
          throw new Error('Incomplete email');
        await transport.sendMail({
          from: this.env.MAIL_FROM,
          to: row.email_to,
          subject: row.email_subject,
          text: row.email_text,
        });
        sent++;
      } catch (e) {
        failed++;
        error = e instanceof Error ? e.message : 'Unknown error';
        this.logger.warn(`Could not deliver ${row.category} email ${row.id}`);
      }
      await this.db.$executeRaw`
        SELECT complete_email_notification(${row.id}::uuid, ${error === null}, ${error}, ${this.env.EMAIL_MAX_ATTEMPTS}::int)`;
    }
    if (rows.length > 0) this.logger.log(`Outbox: ${sent} sent, ${failed} failed`);
    return { claimed: rows.length, sent, failed };
  }
}
