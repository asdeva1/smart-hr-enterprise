import { Inject, Injectable, Logger } from '@nestjs/common';
import { createNotifications, setTenantContext, type DatabaseClient } from '@smart-hr/database';
import { NOTIFICATION_CATEGORIES } from '@smart-hr/shared';
import type { WorkerEnv } from '../config/env.js';
import { DATABASE, WORKER_ENV } from '../queues.js';

const BATCH = 100;

export interface DocumentSweepResult {
  reminded: number;
  expired: number;
  skipped: boolean;
}

const day = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Daily housekeeping for documents: reminds the employee and whoever added a document that it is about to
 * expire (once per expiry date), and closes signature requests past their deadline, telling the sender and
 * anyone still to sign. Works inside each organisation's own context; the database function only says which
 * organisations have something due.
 */
@Injectable()
export class DocumentSweepService {
  private readonly logger = new Logger(DocumentSweepService.name);

  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
  ) {}

  private url(link: string) {
    return new URL(link, this.env.APP_PUBLIC_URL).toString();
  }

  async sweep(): Promise<DocumentSweepResult> {
    const result = await this.db.$transaction(async (tx) => {
      // One sweep at a time across worker replicas.
      const lock = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext('document-sweep')) AS locked`;
      if (!lock[0]?.locked) return null;
      const days = this.env.DOCUMENT_REMINDER_DAYS;
      const due = await tx.$queryRaw<{ tenant_id: string }[]>`
        SELECT tenant_id FROM document_sweep_due(${days}::int, ${BATCH}::int)`;
      let reminded = 0;
      let expired = 0;
      const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      const until = new Date(today.getTime() + days * 86_400_000);
      const now = new Date();

      for (const { tenant_id: tenantId } of due) {
        await setTenantContext(tx, tenantId);

        const docs = await tx.employeeDocument.findMany({
          where: { status: 'ACTIVE', expiryNotifiedAt: null, expiresOn: { not: null, lte: until } },
          select: {
            id: true,
            title: true,
            expiresOn: true,
            visibleToEmployee: true,
            uploadedByUserId: true,
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                preferredName: true,
                membership: { select: { userId: true, status: true } },
              },
            },
          },
          take: 500,
        });
        for (const d of docs) {
          // Conditional, so a reminder goes out once even if two sweeps overlap.
          const claimed = await tx.employeeDocument.updateMany({
            where: { id: d.id, expiryNotifiedAt: null },
            data: { expiryNotifiedAt: now },
          });
          if (claimed.count !== 1) continue;
          const name = `${d.employee.preferredName || d.employee.firstName} ${d.employee.lastName}`;
          const past = d.expiresOn! < today;
          const when = `${past ? 'expired' : 'expires'} on ${day(d.expiresOn!)}`;
          const employeeUser =
            d.visibleToEmployee && d.employee.membership?.status === 'ACTIVE'
              ? d.employee.membership.userId
              : null;
          const recipients = [d.uploadedByUserId, ...(employeeUser ? [employeeUser] : [])];
          const link = `/employees/${d.employee.id}?tab=documents`;
          await createNotifications(tx, tenantId, {
            recipientUserIds: recipients,
            category: 'document.expiring',
            emailDefault: NOTIFICATION_CATEGORIES['document.expiring'].emailDefault,
            title: `${d.title} ${when}`,
            body: `${name}’s document “${d.title}” ${when}. Upload a current copy when there is one.`,
            link,
            email: {
              subject: `A document ${past ? 'has expired' : 'is about to expire'}: ${d.title}`,
              text: `${name}’s document “${d.title}” ${when}. Upload a current copy when there is one.\n\n${this.url(link)}`,
            },
          });
          reminded++;
        }

        const overdue = await tx.signatureRequest.findMany({
          where: { status: 'PENDING', expiresAt: { not: null, lte: now } },
          select: {
            id: true,
            title: true,
            requestedByUserId: true,
            signers: { where: { status: 'PENDING' }, select: { userId: true } },
          },
          take: 500,
        });
        for (const r of overdue) {
          const closed = await tx.signatureRequest.updateMany({
            where: { id: r.id, status: 'PENDING' },
            data: { status: 'EXPIRED', closedAt: now },
          });
          if (closed.count !== 1) continue;
          const link = `/documents/signatures/${r.id}`;
          await createNotifications(tx, tenantId, {
            recipientUserIds: [r.requestedByUserId, ...r.signers.map((s) => s.userId)],
            category: 'document.signature',
            emailDefault: NOTIFICATION_CATEGORIES['document.signature'].emailDefault,
            title: `Not signed in time: ${r.title}`,
            body: `The request to sign “${r.title}” passed its deadline before everyone signed. Send it again if it is still needed.`,
            link,
            email: {
              subject: `Not signed in time: ${r.title}`,
              text: `The request to sign “${r.title}” passed its deadline before everyone signed. Send it again if it is still needed.\n\n${this.url(link)}`,
            },
          });
          await tx.auditEvent.createMany({
            data: [
              {
                action: 'signature.expire',
                outcome: 'SUCCESS',
                tenantId,
                targetType: 'signature_request',
                targetId: r.id,
                metadata: { source: 'document-sweep' },
              },
            ],
          });
          expired++;
        }
      }
      return { reminded, expired };
    });
    if (result === null) return { reminded: 0, expired: 0, skipped: true };
    if (result.reminded || result.expired) {
      this.logger.log(
        `Sent ${result.reminded} document reminder(s), closed ${result.expired} signature request(s)`,
      );
    }
    return { ...result, skipped: false };
  }
}
