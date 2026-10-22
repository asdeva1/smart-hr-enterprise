import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { NotificationJob, QUEUES, type EmailJobData } from '@smart-hr/shared';
import { Queue } from 'bullmq';
import type { Transporter } from 'nodemailer';
import type { WorkerEnv } from '../config/env.js';
import { MAIL_TRANSPORT, WORKER_ENV } from '../queues.js';

export interface MailQueueResult {
  found: number;
  sent: number;
  failed: number;
}

const BATCH = 25;

/** The SMTP reply (code and reason) for the logs, with any email address masked. */
function errorCode(e: unknown): string {
  const err = (e as { responseCode?: unknown; code?: unknown; response?: unknown } | null) ?? {};
  const reason =
    typeof err.response === 'string' ? err.response.replace(/\S+@\S+/g, '[address]').slice(0, 160) : '';
  if (typeof err.responseCode === 'number') return `${err.responseCode} ${reason}`.trim();
  if (typeof err.code === 'string') return err.code;
  return e instanceof Error ? e.name : 'error';
}

/**
 * Sends the emails the API queued in Redis (password resets, invitations, sign-up links) for hosts with no
 * always-on worker. On such hosts nothing reads the queue, so a scheduler calls this instead. A sent job is
 * removed; a failed one stays for the next run until it has been tried EMAIL_MAX_ATTEMPTS times.
 * Logs carry job ids and categories only — never addresses or content.
 */
@Injectable()
export class MailQueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(MailQueueService.name);
  private queue: Queue<EmailJobData> | undefined;

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: Transporter | null,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
  ) {}

  private getQueue(): Queue<EmailJobData> {
    this.queue ??= new Queue<EmailJobData>(QUEUES.notifications, {
      prefix: this.env.QUEUE_PREFIX,
      connection: { url: this.env.REDIS_URL, maxRetriesPerRequest: 1, connectTimeout: 15_000 },
    });
    return this.queue;
  }

  async sweep(): Promise<MailQueueResult> {
    // Without a transport, leave emails queued rather than burning their attempts.
    if (!this.transport) return { found: 0, sent: 0, failed: 0 };
    const jobs = await this.getQueue().getJobs(['waiting', 'delayed', 'prioritized'], 0, BATCH - 1, true);
    let sent = 0;
    let failed = 0;
    for (const job of jobs) {
      if (job.name !== NotificationJob.Email) continue;
      const { to, subject, text, html, category } = job.data;
      try {
        await this.transport.sendMail({
          from: this.env.MAIL_FROM,
          to,
          subject,
          text,
          ...(html ? { html } : {}),
        });
        sent++;
        await job.remove();
        this.logger.log(`Delivered ${category} email ${job.id}`);
      } catch (e) {
        failed++;
        const tries = (typeof job.progress === 'number' ? job.progress : 0) + 1;
        this.logger.warn(`Could not deliver ${category} email ${job.id} (try ${tries}, ${errorCode(e)})`);
        if (tries >= this.env.EMAIL_MAX_ATTEMPTS) await job.remove();
        else await job.updateProgress(tries);
      }
    }
    return { found: jobs.length, sent, failed };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue?.close();
  }
}
