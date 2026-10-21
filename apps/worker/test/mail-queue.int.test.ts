/** The serverless mail sweep: emails the API queued in Redis are sent by a scheduled run instead of a worker. */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NotificationJob, QUEUES, type EmailJobData } from '@smart-hr/shared';
import { Queue } from 'bullmq';
import { createTransport, type SendMailOptions, type Transporter } from 'nodemailer';
import { afterAll, describe, expect, it } from 'vitest';
import { loadWorkerEnv } from '../src/config/env.js';
import { MailQueueService } from '../src/notifications/mail-queue.service.js';

const prefix = `test-mailq-${randomUUID().slice(0, 8)}`;
const env = loadWorkerEnv({
  ...process.env,
  NODE_ENV: 'test',
  QUEUE_PREFIX: prefix,
  EMAIL_MAX_ATTEMPTS: '2',
});
const queue = new Queue<EmailJobData>(QUEUES.notifications, {
  prefix,
  connection: { url: process.env.REDIS_URL! },
});
const sent: SendMailOptions[] = [];
const refused = new Set<string>();

function transport(): Transporter {
  const t = createTransport({ jsonTransport: true });
  const realSend = t.sendMail.bind(t);
  t.sendMail = async (mail: SendMailOptions) => {
    if (typeof mail.to === 'string' && refused.has(mail.to)) throw new Error('550 refused');
    sent.push(mail);
    return realSend(mail);
  };
  return t;
}

afterAll(async () => {
  await queue.obliterate({ force: true });
  await queue.close();
});

describe('mail queue sweep', () => {
  it('sends queued emails and removes them', async () => {
    await queue.add(NotificationJob.Email, {
      to: 'a@example.test',
      category: 'password_reset',
      subject: 'Hi',
      text: 'Body',
    });
    const service = new MailQueueService(transport(), env);
    expect(await service.sweep()).toEqual({ found: 1, sent: 1, failed: 0 });
    expect(sent.map((m) => m.to)).toEqual(['a@example.test']);
    expect(await service.sweep()).toEqual({ found: 0, sent: 0, failed: 0 });
    await service.onApplicationShutdown();
  });

  it('keeps a failing email for one more try, then drops it', async () => {
    refused.add('b@example.test');
    await queue.add(NotificationJob.Email, {
      to: 'b@example.test',
      category: 'invitation',
      subject: 'S',
      text: 'T',
    });
    const service = new MailQueueService(transport(), env);
    expect(await service.sweep()).toEqual({ found: 1, sent: 0, failed: 1 });
    expect(await service.sweep()).toEqual({ found: 1, sent: 0, failed: 1 });
    expect(await service.sweep()).toEqual({ found: 0, sent: 0, failed: 0 });
    await service.onApplicationShutdown();
  });

  it('leaves emails queued when no mail server is configured', async () => {
    await queue.add(NotificationJob.Email, {
      to: 'c@example.test',
      category: 'x',
      subject: 'S',
      text: 'T',
    });
    const service = new MailQueueService(null, env);
    expect(await service.sweep()).toEqual({ found: 0, sent: 0, failed: 0 });
    expect(await queue.getWaitingCount()).toBe(1);
  });
});
