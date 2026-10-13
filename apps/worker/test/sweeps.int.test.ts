/**
 * The outbox and escalation sweeps against the real database, running as app_rw like the deployed worker.
 * Fixtures are written with the owner connection. Other test files may leave pending rows of their own,
 * so assertions only look at this file's rows and recipients.
 * Requires DATABASE_URL (app_rw), DATABASE_MIGRATOR_URL (owner, fixtures only) and REDIS_URL.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createDatabaseClient } from '@smart-hr/database';
import { Redis } from 'ioredis';
import { createTransport, type SendMailOptions, type Transporter } from 'nodemailer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadWorkerEnv } from '../src/config/env.js';
import { EscalationService } from '../src/notifications/escalation.service.js';
import { OutboxService } from '../src/notifications/outbox.service.js';
import { WorkerModule } from '../src/worker.module.js';

const run = randomUUID().slice(0, 8);
const prefix = `test-sweep-${run}`;
const owner = createDatabaseClient({
  connectionString: process.env.DATABASE_MIGRATOR_URL!,
  maxConnections: 2,
});
const sent: SendMailOptions[] = [];
/** Recipients whose delivery fails, as if the SMTP server refused them. */
const refused = new Set<string>();
const tenants: string[] = [];
const users: string[] = [];
let app: INestApplicationContext;
let outbox: OutboxService;
let escalation: EscalationService;

function capturingTransport(): Transporter {
  const transport = createTransport({ jsonTransport: true });
  const realSend = transport.sendMail.bind(transport);
  transport.sendMail = async (mail: SendMailOptions) => {
    if (typeof mail.to === 'string' && refused.has(mail.to)) throw new Error('550 mailbox unavailable');
    sent.push(mail);
    return realSend(mail);
  };
  return transport;
}

beforeAll(async () => {
  const env = loadWorkerEnv({
    ...process.env,
    NODE_ENV: 'test',
    QUEUE_PREFIX: prefix,
    MAIL_FROM: 'Smart HR <no-reply@test.local>',
    APP_PUBLIC_URL: 'https://hr.example.test',
    EMAIL_MAX_ATTEMPTS: '2',
    // The tests run the sweeps themselves.
    EMAIL_SWEEP_INTERVAL_MS: '0',
    APPROVAL_ESCALATION_INTERVAL_MS: '0',
  });
  app = await NestFactory.createApplicationContext(
    WorkerModule.forRoot(env, { mailTransport: capturingTransport() }),
    {
      logger: false,
    },
  );
  outbox = app.get(OutboxService);
  escalation = app.get(EscalationService);
});

afterAll(async () => {
  await app?.close();
  const inTenants = { tenantId: { in: tenants } };
  await owner.notification.deleteMany({ where: inTenants });
  await owner.approvalTask.deleteMany({ where: inTenants });
  await owner.approvalRequest.deleteMany({ where: inTenants });
  await owner.approvalPolicy.deleteMany({ where: inTenants });
  await owner.tenantMembership.deleteMany({ where: inTenants });
  await owner.user.deleteMany({ where: { id: { in: users } } });
  await owner.tenant.deleteMany({ where: { id: { in: tenants } } });
  await owner.$disconnect();
  const redis = new Redis(process.env.REDIS_URL!);
  const keys = await redis.keys(`${prefix}:*`);
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});

async function tenant(name: string) {
  const t = await owner.tenant.create({ data: { slug: `${name}-${run}-${tenants.length}`, name } });
  tenants.push(t.id);
  return t;
}

async function member(tenantId: string, label: string, isTenantAdmin = false) {
  const user = await owner.user.create({
    data: { email: `${label}-${run}-${users.length}@test.local`, displayName: label },
  });
  users.push(user.id);
  const membership = await owner.tenantMembership.create({
    data: { tenantId, userId: user.id, isTenantAdmin },
  });
  return { user, membership };
}

async function pendingEmail(tenantId: string, user: { id: string; email: string }, subject: string) {
  return owner.notification.create({
    data: {
      tenantId,
      recipientUserId: user.id,
      category: 'approval.assigned',
      title: subject,
      body: subject,
      emailStatus: 'PENDING',
      emailTo: user.email,
      emailSubject: subject,
      emailText: `${subject} — body`,
    },
  });
}

describe('email outbox', () => {
  it('delivers pending emails from every organisation once, then forgets their content', async () => {
    const a = await tenant('outbox-a');
    const b = await tenant('outbox-b');
    const asha = await member(a.id, 'asha');
    const bala = await member(b.id, 'bala');
    const n1 = await pendingEmail(a.id, asha.user, `A1 ${run}`);
    const n2 = await pendingEmail(b.id, bala.user, `B1 ${run}`);
    const inApp = await owner.notification.create({
      data: {
        tenantId: a.id,
        recipientUserId: asha.user.id,
        category: 'approval.assigned',
        title: 'x',
        body: 'x',
      },
    });

    await outbox.sweep();
    const mine = sent.filter((m) => String(m.subject).endsWith(run));
    expect(mine.map((m) => [m.to, m.subject]).sort()).toEqual(
      [
        [asha.user.email, `A1 ${run}`],
        [bala.user.email, `B1 ${run}`],
      ].sort(),
    );
    expect(mine[0]!.from).toBe('Smart HR <no-reply@test.local>');

    for (const id of [n1.id, n2.id]) {
      const row = await owner.notification.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({
        emailStatus: 'SENT',
        emailText: null,
        emailAttempts: 1,
        emailLastError: null,
      });
    }
    expect((await owner.notification.findUniqueOrThrow({ where: { id: inApp.id } })).emailStatus).toBe(
      'NOT_REQUESTED',
    );

    await outbox.sweep();
    expect(sent.filter((m) => String(m.subject).endsWith(run))).toHaveLength(2);
  });

  it('retries a refused email after the claim window, then gives up', async () => {
    const t = await tenant('outbox-fail');
    const chen = await member(t.id, 'chen');
    refused.add(chen.user.email);
    const n = await pendingEmail(t.id, chen.user, `Refused ${run}`);

    await outbox.sweep();
    let row = await owner.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(row).toMatchObject({
      emailStatus: 'PENDING',
      emailAttempts: 1,
      emailLastError: '550 mailbox unavailable',
    });

    // Still inside the claim window: not retried yet.
    await outbox.sweep();
    expect((await owner.notification.findUniqueOrThrow({ where: { id: n.id } })).emailAttempts).toBe(1);

    // Age the claim past the window; the second failure reaches EMAIL_MAX_ATTEMPTS (2).
    await owner.notification.update({
      where: { id: n.id },
      data: { emailClaimedAt: new Date(Date.now() - 3_600_000) },
    });
    await outbox.sweep();
    row = await owner.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(row).toMatchObject({ emailStatus: 'FAILED', emailAttempts: 2 });
    // Kept for the failed-email view; never sent.
    expect(row.emailText).not.toBeNull();
  });

  it('cannot be claimed or completed by the app role outside the functions', async () => {
    const appRole = createDatabaseClient({ connectionString: process.env.DATABASE_URL!, maxConnections: 1 });
    try {
      // Without a tenant context RLS shows nothing, and email columns are not updatable directly.
      expect(await appRole.notification.count()).toBe(0);
      await expect(
        appRole.$executeRaw`UPDATE notification SET email_status = 'SENT' WHERE email_status = 'PENDING'`,
      ).rejects.toThrow(/permission denied/);
    } finally {
      await appRole.$disconnect();
    }
  });
});

describe('approval escalation', () => {
  it('reminds the approver and alerts the other owners about an overdue task, once', async () => {
    const t = await tenant('escalate');
    const boss = await member(t.id, 'boss', true);
    const coOwner = await member(t.id, 'coowner', true);
    const asha = await member(t.id, 'asha');
    const policy = await owner.approvalPolicy.create({
      data: {
        tenantId: t.id,
        subjectType: 'expense_claim',
        version: 1,
        name: 'Owners',
        definition: { stages: [{ name: 'Owners', mode: 'ANY', approvers: [{ type: 'OWNERS' }] }] },
      },
    });
    const request = await owner.approvalRequest.create({
      data: {
        tenantId: t.id,
        policyId: policy.id,
        subjectType: 'expense_claim',
        subjectId: randomUUID(),
        title: `Taxi ${run}`,
        scopeType: 'TENANT',
        scopeId: t.id,
        requestedByMembershipId: asha.membership.id,
      },
    });
    const overdue = await owner.approvalTask.create({
      data: {
        tenantId: t.id,
        requestId: request.id,
        round: 1,
        stage: 0,
        stageName: 'Owners',
        assigneeMembershipId: boss.membership.id,
        dueAt: new Date(Date.now() - 60_000),
      },
    });
    const notDue = await owner.approvalTask.create({
      data: {
        tenantId: t.id,
        requestId: request.id,
        round: 1,
        stage: 0,
        stageName: 'Owners',
        assigneeMembershipId: coOwner.membership.id,
        dueAt: new Date(Date.now() + 3_600_000),
      },
    });

    await escalation.sweep();
    const notes = await owner.notification.findMany({
      where: { tenantId: t.id },
      orderBy: { category: 'asc' },
    });
    expect(notes.map((n) => [n.category, n.recipientUserId])).toEqual([
      ['approval.escalated', coOwner.user.id],
      ['approval.overdue', boss.user.id],
    ]);
    // The approver is emailed by default; the owners' alert is in-app unless they opt in.
    expect(notes.map((n) => n.emailStatus)).toEqual(['NOT_REQUESTED', 'PENDING']);
    expect(notes[1]!.emailText).toContain(`https://hr.example.test/approvals/${request.id}`);
    expect(notes.every((n) => n.link === `/approvals/${request.id}`)).toBe(true);

    expect(
      (await owner.approvalTask.findUniqueOrThrow({ where: { id: overdue.id } })).escalatedAt,
    ).not.toBeNull();
    expect((await owner.approvalTask.findUniqueOrThrow({ where: { id: notDue.id } })).escalatedAt).toBeNull();
    // Escalation only notifies: nothing is decided on anyone's behalf.
    expect((await owner.approvalTask.findUniqueOrThrow({ where: { id: overdue.id } })).status).toBe(
      'PENDING',
    );
    expect((await owner.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe(
      'PENDING',
    );

    await escalation.sweep();
    expect(await owner.notification.count({ where: { tenantId: t.id } })).toBe(2);
  });
});
