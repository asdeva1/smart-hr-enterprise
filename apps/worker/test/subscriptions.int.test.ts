/**
 * The subscription expiry sweep against the real database, running as app_rw like the deployed worker.
 * Fixtures are written with the owner connection.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createDatabaseClient } from '@smart-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadWorkerEnv } from '../src/config/env.js';
import { SubscriptionExpiryService } from '../src/notifications/subscription-expiry.service.js';
import { WorkerModule } from '../src/worker.module.js';

const run = randomUUID().slice(0, 8);
const owner = createDatabaseClient({
  connectionString: process.env.DATABASE_MIGRATOR_URL!,
  maxConnections: 2,
});
const tenants: string[] = [];
const users: string[] = [];
let planId: string;
let versionId: string;
let app: INestApplicationContext;
let sweeper: SubscriptionExpiryService;

const DAY = 86_400_000;
const days = (n: number) => new Date(Date.now() + n * DAY);

beforeAll(async () => {
  const env = loadWorkerEnv({
    ...process.env,
    NODE_ENV: 'test',
    QUEUE_PREFIX: `test-subs-${run}`,
    EMAIL_SWEEP_INTERVAL_MS: '0',
    APPROVAL_ESCALATION_INTERVAL_MS: '0',
    SUBSCRIPTION_SWEEP_INTERVAL_MS: '0',
  });
  app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env, { mailTransport: null }), {
    logger: false,
  });
  sweeper = app.get(SubscriptionExpiryService);
  const plan = await owner.plan.create({
    data: {
      code: `SWEEP${run}`.toUpperCase(),
      name: 'Sweep test',
      versions: {
        create: {
          version: 1,
          status: 'PUBLISHED',
          publishedAt: new Date(),
          features: ['hr.core'],
          graceDays: 3,
          deploymentModels: ['SAAS'],
        },
      },
    },
    include: { versions: true },
  });
  planId = plan.id;
  versionId = plan.versions[0]!.id;
});

afterAll(async () => {
  await app?.close();
  const inTenants = { tenantId: { in: tenants } };
  await owner.notification.deleteMany({ where: inTenants });
  await owner.subscriptionEvent.deleteMany({ where: inTenants });
  await owner.subscription.deleteMany({ where: inTenants });
  await owner.tenantMembership.deleteMany({ where: inTenants });
  await owner.user.deleteMany({ where: { id: { in: users } } });
  await owner.tenant.deleteMany({ where: { id: { in: tenants } } });
  await owner.planVersion.deleteMany({ where: { planId } }).catch(() => undefined);
  await owner.$disconnect();
});

async function organisation(
  label: string,
  sub: {
    status: 'TRIAL' | 'ACTIVE' | 'CANCELLED' | 'PAST_DUE';
    trialEndsAt?: Date;
    currentPeriodEnd?: Date;
    graceEndsAt?: Date;
  },
) {
  const tenant = await owner.tenant.create({
    data: { slug: `sweep-${label}-${run}`.toLowerCase(), name: label },
  });
  tenants.push(tenant.id);
  const user = await owner.user.create({
    data: { email: `owner-${label}-${run}@test.local`.toLowerCase(), displayName: `${label} owner` },
  });
  users.push(user.id);
  await owner.tenantMembership.create({
    data: { tenantId: tenant.id, userId: user.id, isTenantAdmin: true },
  });
  await owner.subscription.create({ data: { tenantId: tenant.id, planVersionId: versionId, ...sub } });
  return { tenantId: tenant.id, ownerId: user.id };
}

const statusOf = async (tenantId: string) =>
  (await owner.subscription.findUniqueOrThrow({ where: { tenantId } })).status;

describe('subscription expiry sweep', () => {
  it('expires exactly the subscriptions past their grace, once, and tells the owners', async () => {
    const lapsedTrial = await organisation('lapsedtrial', { status: 'TRIAL', trialEndsAt: days(-10) });
    const graceTrial = await organisation('gracetrial', { status: 'TRIAL', trialEndsAt: days(-1) });
    const lapsedPaid = await organisation('lapsedpaid', { status: 'ACTIVE', currentPeriodEnd: days(-4) });
    const openEnded = await organisation('openended', { status: 'ACTIVE' });
    const cancelled = await organisation('cancelled', { status: 'CANCELLED', currentPeriodEnd: days(-1) });
    const pastDue = await organisation('pastdue', { status: 'PAST_DUE', graceEndsAt: days(-1) });
    const pastDueGrace = await organisation('pastduegrace', { status: 'PAST_DUE', graceEndsAt: days(2) });

    // The first round runs three sweeps at once, as several worker replicas (or this app's own timer) would:
    // none may expire anything twice. Then sweep until a sweep that got its turn found nothing left due;
    // a sweep that skipped because another held the lock proves nothing, so it doesn't count.
    await Promise.all([sweeper.sweep(), sweeper.sweep(), sweeper.sweep()]);
    for (let i = 0; ; i++) {
      expect(i).toBeLessThan(200);
      const r = await sweeper.sweep();
      if (!r.skipped && r.expired === 0) break;
      if (r.skipped) await new Promise((resolve) => setTimeout(resolve, 50));
    }

    for (const org of [lapsedTrial, lapsedPaid, cancelled, pastDue]) {
      expect(await statusOf(org.tenantId)).toBe('EXPIRED');
    }
    expect(await statusOf(graceTrial.tenantId)).toBe('TRIAL');
    expect(await statusOf(openEnded.tenantId)).toBe('ACTIVE');
    expect(await statusOf(pastDueGrace.tenantId)).toBe('PAST_DUE');

    const events = await owner.subscriptionEvent.findMany({
      where: { tenantId: lapsedTrial.tenantId, action: 'expire' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromStatus: 'TRIAL', toStatus: 'EXPIRED' });

    const notices = await owner.notification.findMany({
      where: { tenantId: lapsedTrial.tenantId, recipientUserId: lapsedTrial.ownerId },
    });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ category: 'subscription.changed', emailStatus: 'PENDING' });

    const audit = await owner.auditEvent.findMany({
      where: { tenantId: lapsedPaid.tenantId, action: 'platform.subscription.expire' },
    });
    expect(audit).toHaveLength(1);
  });
});
