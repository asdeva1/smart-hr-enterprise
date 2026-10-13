import type { TenantTransaction } from './index.js';

export interface NotificationInput {
  /** Users to notify. Duplicates are ignored. */
  recipientUserIds: string[];
  category: string;
  title: string;
  body: string;
  /** Relative path in the web app. */
  link?: string;
  /** Email version. Sent only if the recipient's preference (or the category default) allows it. */
  email?: { subject: string; text: string };
  /** Whether email is on for this category when the person has not set a preference. */
  emailDefault: boolean;
}

/**
 * Writes in-app notifications inside the caller's tenant transaction. Rows that should also be emailed are
 * marked PENDING: the worker delivers them later, so the email is as durable as the change that caused it.
 * Uses `createMany` (no RETURNING) because the writer usually can't read other people's notifications.
 */
export async function createNotifications(
  tx: TenantTransaction,
  tenantId: string,
  input: NotificationInput,
): Promise<number> {
  const userIds = [...new Set(input.recipientUserIds)];
  if (userIds.length === 0) return 0;

  // Sequential: queries in one transaction share a connection.
  const users = await tx.user.findMany({
    where: { id: { in: userIds }, status: 'ACTIVE' },
    select: { id: true, email: true },
  });
  const preferences = input.email
    ? await tx.notificationPreference.findMany({
        where: { tenantId, userId: { in: userIds }, category: input.category },
        select: { userId: true, emailEnabled: true },
      })
    : [];
  const emailOn = new Map(preferences.map((p) => [p.userId, p.emailEnabled]));

  const result = await tx.notification.createMany({
    data: users.map((user) => {
      const wantsEmail = !!input.email && (emailOn.get(user.id) ?? input.emailDefault);
      return {
        tenantId,
        recipientUserId: user.id,
        category: input.category,
        title: input.title.slice(0, 200),
        body: input.body.slice(0, 2000),
        link: input.link ?? null,
        ...(wantsEmail
          ? {
              emailStatus: 'PENDING' as const,
              emailTo: user.email,
              emailSubject: input.email!.subject.slice(0, 200),
              emailText: input.email!.text,
            }
          : {}),
      };
    }),
  });
  return result.count;
}
