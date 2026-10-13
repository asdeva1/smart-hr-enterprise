import { Inject, Injectable } from '@nestjs/common';
import { withContext, type DatabaseClient } from '@smart-hr/database';
import { AppError, isNotificationCategory, NOTIFICATION_CATEGORIES, NotFoundError } from '@smart-hr/shared';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { DATABASE } from '../infra/tokens.js';

/** The signed-in person's own notifications in the active organisation. RLS limits every query to them. */
@Injectable()
export class NotificationService {
  constructor(@Inject(DATABASE) private readonly db: DatabaseClient) {}

  private run<T>(tenant: TenantContext, auth: AuthContext, work: Parameters<typeof withContext<T>>[2]) {
    return withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, work);
  }

  async list(tenant: TenantContext, auth: AuthContext, unreadOnly: boolean) {
    return this.run(tenant, auth, async (tx) => {
      const where = { recipientUserId: auth.user.id, ...(unreadOnly ? { readAt: null } : {}) };
      const items = await tx.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          category: true,
          title: true,
          body: true,
          link: true,
          createdAt: true,
          readAt: true,
        },
      });
      const unread = await tx.notification.count({ where: { recipientUserId: auth.user.id, readAt: null } });
      return { items, unread };
    });
  }

  async markRead(tenant: TenantContext, auth: AuthContext, id: string) {
    await this.run(tenant, auth, async (tx) => {
      const updated = await tx.notification.updateMany({
        where: { id, recipientUserId: auth.user.id, readAt: null },
        data: { readAt: new Date() },
      });
      if (
        updated.count === 0 &&
        !(await tx.notification.findUnique({ where: { id }, select: { id: true } }))
      ) {
        throw new NotFoundError('Notification');
      }
    });
  }

  async markAllRead(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const updated = await tx.notification.updateMany({
        where: { recipientUserId: auth.user.id, readAt: null },
        data: { readAt: new Date() },
      });
      return { marked: updated.count };
    });
  }

  async preferences(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const saved = await tx.notificationPreference.findMany({ where: { userId: auth.user.id } });
      return Object.entries(NOTIFICATION_CATEGORIES).map(([category, def]) => ({
        category,
        label: def.label,
        emailEnabled: saved.find((p) => p.category === category)?.emailEnabled ?? def.emailDefault,
      }));
    });
  }

  async setPreference(tenant: TenantContext, auth: AuthContext, category: string, emailEnabled: boolean) {
    if (!isNotificationCategory(category)) {
      throw new AppError('UNKNOWN_CATEGORY', 'Unknown notification category', 400);
    }
    await this.run(tenant, auth, (tx) =>
      tx.notificationPreference.upsert({
        where: { tenantId_userId_category: { tenantId: tenant.id, userId: auth.user.id, category } },
        create: { tenantId: tenant.id, userId: auth.user.id, category, emailEnabled },
        update: { emailEnabled },
      }),
    );
    return { category, emailEnabled };
  }
}
