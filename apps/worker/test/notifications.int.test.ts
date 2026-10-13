/**
 * The worker takes emails off the real Redis queue (as the API puts them there) and hands them to the
 * mail transport. A capturing transport stands in for SMTP; CI's browser tests exercise real SMTP via Mailpit.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NotificationJob, QUEUES, type EmailJobData } from '@smart-hr/shared';
import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { createTransport } from 'nodemailer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadWorkerEnv } from '../src/config/env.js';
import { WorkerModule } from '../src/worker.module.js';

const prefix = `test-mail-${randomUUID().slice(0, 8)}`;
const sent: { envelope: { from: string; to: string[] }; message: string }[] = [];
let app: INestApplicationContext;
let queue: Queue<EmailJobData>;
let events: QueueEvents;

beforeAll(async () => {
  const env = loadWorkerEnv({
    ...process.env,
    NODE_ENV: 'test',
    QUEUE_PREFIX: prefix,
    MAIL_FROM: 'Smart HR <no-reply@test.local>',
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://unused@localhost/unused',
  });
  // jsonTransport renders the full message without a network, like a mailbox we can inspect.
  const capture = createTransport({ jsonTransport: true });
  const realSend = capture.sendMail.bind(capture);
  capture.sendMail = (async (mail: Parameters<typeof realSend>[0]) => {
    const info = (await realSend(mail)) as { envelope: { from: string; to: string[] }; message: string };
    sent.push(info);
    return info;
  }) as typeof capture.sendMail;

  app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env, { mailTransport: capture }), {
    logger: false,
  });
  queue = new Queue<EmailJobData>(QUEUES.notifications, { prefix, connection: { url: env.REDIS_URL } });
  events = new QueueEvents(QUEUES.notifications, { prefix, connection: { url: env.REDIS_URL } });
  await events.waitUntilReady();
});

afterAll(async () => {
  await app?.close();
  await queue?.obliterate({ force: true });
  await queue?.close();
  await events?.close();
  const redis = new Redis(process.env.REDIS_URL!);
  const keys = await redis.keys(`${prefix}:*`);
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});

describe('email delivery', () => {
  it('sends a queued email from the configured sender', async () => {
    const job = await queue.add(NotificationJob.Email, {
      to: 'asha@test.local',
      subject: 'Reset your Smart HR password',
      text: 'Open this link: https://app.test/reset-password?token=abc',
      category: 'password_reset',
    });
    const result = (await job.waitUntilFinished(events, 10_000)) as { delivered: boolean };

    expect(result).toEqual({ delivered: true });
    const mail = sent.find((m) => m.envelope.to.includes('asha@test.local'));
    expect(mail?.envelope.from).toBe('no-reply@test.local');
    expect(JSON.parse(mail!.message)).toMatchObject({ subject: 'Reset your Smart HR password' });
  });

  it('fails unknown jobs loudly so they surface as failed jobs', async () => {
    const job = await queue.add(
      'email.unknown',
      {
        to: 'x@test.local',
        subject: 'x',
        text: 'x',
        category: 'test',
      },
      { attempts: 1 },
    );
    await expect(job.waitUntilFinished(events, 10_000)).rejects.toThrow(/Unknown notification job/);
  });
});
