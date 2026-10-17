import { Inject, Injectable, Logger } from '@nestjs/common';
import { createNotifications, setTenantContext, type DatabaseClient } from '@smart-hr/database';
import { NOTIFICATION_CATEGORIES } from '@smart-hr/shared';
import type { WorkerEnv } from '../config/env.js';
import { DATABASE, WORKER_ENV } from '../queues.js';

const BATCH = 100;

/**
 * Records subscriptions whose trial or paid period, plus grace, has run out. The API already treats them as
 * read-only by their dates; this makes the stored status, the subscription history and the audit log agree,
 * and tells the organisation's owners once. Nothing is deleted: expired organisations keep reading and
 * exporting their data.
 */
@Injectable()
export class SubscriptionExpiryService {
  private readonly logger = new Logger(SubscriptionExpiryService.name);

  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
  ) {}

  async sweep(): Promise<{ expired: number; skipped: boolean }> {
    const result = await this.db.$transaction(async (tx) => {
      // A platform action: the database only lets platform actors write subscriptions.
      await tx.$executeRaw`SELECT set_config('app.platform_actor', 'on', true)`;
      // One sweep at a time across every worker replica: an overlapping run skips its turn instead of
      // expiring (and notifying about) the same subscriptions twice.
      const lock = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext('subscription-expiry-sweep')) AS locked`;
      if (!lock[0]?.locked) return null;
      const due = await tx.$queryRaw<{ tenant_id: string }[]>`
        SELECT tenant_id FROM subscriptions_due_to_expire(${BATCH}::int)`;
      let count = 0;
      for (const { tenant_id: tenantId } of due) {
        await setTenantContext(tx, tenantId);
        const before = await tx.subscription.findFirst({ where: { tenantId } });
        if (!before || before.status === 'EXPIRED' || before.status === 'SUSPENDED') continue;
        // Conditional on the status just read, so the history and notices are written exactly once.
        const changed = await tx.subscription.updateMany({
          where: { id: before.id, status: before.status },
          data: { status: 'EXPIRED' },
        });
        if (changed.count !== 1) continue;
        await tx.subscriptionEvent.create({
          data: {
            tenantId,
            action: 'expire',
            fromStatus: before.status,
            toStatus: 'EXPIRED',
            planVersionId: before.planVersionId,
            details: { source: 'expiry-sweep' },
          },
        });
        await tx.auditEvent.createMany({
          data: [
            {
              action: 'platform.subscription.expire',
              outcome: 'SUCCESS',
              tenantId,
              targetType: 'subscription',
              targetId: tenantId,
              metadata: { from: before.status, to: 'EXPIRED' },
            },
          ],
        });
        const owners = await tx.tenantMembership.findMany({
          where: { isTenantAdmin: true, status: 'ACTIVE' },
          select: { userId: true },
        });
        const link = '/admin/plan';
        await createNotifications(tx, tenantId, {
          recipientUserIds: owners.map((o) => o.userId),
          category: 'subscription.changed',
          emailDefault: NOTIFICATION_CATEGORIES['subscription.changed'].emailDefault,
          title: 'Your subscription has ended',
          body: 'Smart HR is now read-only for your organisation. Your data is safe; renew to make changes again.',
          link,
          email: {
            subject: 'Your Smart HR subscription has ended',
            text: `Your organisation's Smart HR subscription has ended, so it is now read-only. Nothing has been deleted: you can still view and export everything.\n\nRenew to make changes again: ${new URL(link, this.env.APP_PUBLIC_URL).toString()}`,
          },
        });
        count++;
      }
      return count;
    });
    if (result === null) return { expired: 0, skipped: true };
    if (result > 0) this.logger.log(`Recorded ${result} expired subscription(s)`);
    return { expired: result, skipped: false };
  }
}
