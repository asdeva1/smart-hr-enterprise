import { Inject, Injectable, Logger } from '@nestjs/common';
import { createNotifications, setTenantContext, type DatabaseClient } from '@smart-hr/database';
import { NOTIFICATION_CATEGORIES } from '@smart-hr/shared';
import type { WorkerEnv } from '../config/env.js';
import { DATABASE, WORKER_ENV } from '../queues.js';

interface ClaimedTask {
  task_id: string;
  tenant_id: string;
  request_id: string;
  assignee_membership_id: string;
}

const BATCH = 100;

/**
 * Reminds approvers about overdue tasks and tells the organisation's owners. The claim (which stamps
 * `escalated_at`) and the notifications commit in one transaction, so a task is escalated exactly once
 * and never silently. It only notifies: the task stays with its approver — nothing is decided automatically.
 */
@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name);

  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
  ) {}

  async sweep(): Promise<{ escalated: number }> {
    const escalated = await this.db.$transaction(async (tx) => {
      const tasks = await tx.$queryRaw<
        ClaimedTask[]
      >`SELECT * FROM claim_overdue_approval_tasks(${BATCH}::int)`;
      for (const task of tasks) {
        // Every read and write below is confined to the task's own tenant by row-level security.
        await setTenantContext(tx, task.tenant_id);
        const request = await tx.approvalRequest.findUnique({
          where: { id: task.request_id },
          select: { id: true, title: true, requestedByMembershipId: true },
        });
        const assignee = await tx.tenantMembership.findUnique({
          where: { id: task.assignee_membership_id },
          select: { userId: true, user: { select: { displayName: true } } },
        });
        if (!request || !assignee) continue;
        const link = `/approvals/${request.id}`;
        const url = new URL(link, this.env.APP_PUBLIC_URL).toString();

        await createNotifications(tx, task.tenant_id, {
          recipientUserIds: [assignee.userId],
          category: 'approval.overdue',
          emailDefault: NOTIFICATION_CATEGORIES['approval.overdue'].emailDefault,
          title: 'An approval is overdue',
          body: `${request.title} is waiting for your decision.`,
          link,
          email: {
            subject: `Overdue approval: ${request.title}`,
            text: `${request.title} is past its due time and still waiting for your decision.\n\nReview it: ${url}`,
          },
        });

        const owners = await tx.tenantMembership.findMany({
          where: {
            isTenantAdmin: true,
            status: 'ACTIVE',
            id: { notIn: [task.assignee_membership_id, request.requestedByMembershipId] },
          },
          select: { userId: true },
        });
        await createNotifications(tx, task.tenant_id, {
          recipientUserIds: owners.map((o) => o.userId),
          category: 'approval.escalated',
          emailDefault: NOTIFICATION_CATEGORIES['approval.escalated'].emailDefault,
          title: 'An approval is overdue',
          body: `${request.title} is overdue with ${assignee.user.displayName}.`,
          link,
          email: {
            subject: `Overdue approval: ${request.title}`,
            text: `${request.title} is overdue with ${assignee.user.displayName}.\n\nDetails: ${url}`,
          },
        });
      }
      return tasks.length;
    });
    if (escalated > 0) this.logger.log(`Escalated ${escalated} overdue approval task(s)`);
    return { escalated };
  }
}
