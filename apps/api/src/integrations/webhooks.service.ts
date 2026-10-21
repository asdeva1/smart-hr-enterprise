import { Inject, Injectable } from '@nestjs/common';
import { SecretBox } from '@smart-hr/auth';
import { withContext, type DatabaseClient, type TenantTransaction } from '@smart-hr/database';
import { AppError, NotFoundError } from '@smart-hr/shared';
import type { createWebhookSchema, deliveryListQuerySchema, updateWebhookSchema } from '@smart-hr/validation';
import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import type { ApiEnv } from '../config/env.js';
import { API_ENV, DATABASE } from '../infra/tokens.js';
import { WebhookEventsService } from './webhook-events.service.js';

const MAX_ENDPOINTS = 10;

type EndpointRow = {
  id: string;
  name: string;
  url: string;
  events: string[];
  status: 'ACTIVE' | 'DISABLED';
  failureStreak: number;
  createdAt: Date;
};

const view = (e: EndpointRow) => ({
  id: e.id,
  name: e.name,
  url: e.url,
  events: e.events,
  status: e.status,
  failureStreak: e.failureStreak,
  createdAt: e.createdAt.toISOString(),
});

/** Where an organisation sends events. The signing secret is shown once, when it is made, and never again. */
@Injectable()
export class WebhooksService {
  private readonly box: SecretBox;

  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(API_ENV) env: ApiEnv,
    private readonly audit: AuditService,
    private readonly events: WebhookEventsService,
  ) {
    this.box = new SecretBox(env.DATA_ENCRYPTION_KEYS, env.DATA_ENCRYPTION_KEY_ID);
  }

  private run<T>(tenant: TenantContext, auth: AuthContext, work: (tx: TenantTransaction) => Promise<T>) {
    return withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, work);
  }

  /** The secret is bound to its organisation, so a copy in another row or organisation can't be read. */
  static aad(tenantId: string, endpointId: string) {
    return `webhook-secret:${tenantId}:${endpointId}`;
  }

  list(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const rows = await tx.webhookEndpoint.findMany({ orderBy: { createdAt: 'desc' } });
      return rows.map(view);
    });
  }

  create(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof createWebhookSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const count = await tx.webhookEndpoint.count({ where: { status: 'ACTIVE' } });
      if (count >= MAX_ENDPOINTS)
        throw new AppError('WEBHOOK_LIMIT', `Up to ${MAX_ENDPOINTS} active webhooks are allowed`, 409);
      const id = crypto.randomUUID();
      const secret = `whsec_${randomBytes(24).toString('base64url')}`;
      const row = await tx.webhookEndpoint.create({
        data: {
          id,
          tenantId: tenant.id,
          name: input.name,
          url: input.url,
          events: input.events,
          secretEnc: this.box.encrypt(secret, WebhooksService.aad(tenant.id, id)),
          createdByUserId: auth.user.id,
        },
      });
      await this.record(tx, tenant, auth, meta, 'integrations.webhook.create', id, {
        events: input.events.length,
      });
      return { ...view(row), secret };
    });
  }

  update(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateWebhookSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await this.load(tx, id);
      if (input.status === 'ACTIVE') {
        const others = await tx.webhookEndpoint.count({ where: { status: 'ACTIVE', id: { not: id } } });
        if (others >= MAX_ENDPOINTS)
          throw new AppError('WEBHOOK_LIMIT', `Up to ${MAX_ENDPOINTS} active webhooks are allowed`, 409);
      }
      const row = await tx.webhookEndpoint.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.url !== undefined ? { url: input.url } : {}),
          ...(input.events !== undefined ? { events: input.events } : {}),
          // Turning it back on starts the failure count again.
          ...(input.status !== undefined ? { status: input.status, failureStreak: 0 } : {}),
        },
      });
      await this.record(tx, tenant, auth, meta, 'integrations.webhook.update', id, {});
      return view(row);
    });
  }

  /** Replaces the signing secret; the old one stops working at once. */
  rotateSecret(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      await this.load(tx, id);
      const secret = `whsec_${randomBytes(24).toString('base64url')}`;
      await tx.webhookEndpoint.update({
        where: { id },
        data: { secretEnc: this.box.encrypt(secret, WebhooksService.aad(tenant.id, id)) },
      });
      await this.record(tx, tenant, auth, meta, 'integrations.webhook.rotate', id, {});
      return { secret };
    });
  }

  /** Queues a harmless test event so the receiver can check its address and signature handling. */
  test(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, async (tx) => {
      const e = await this.load(tx, id);
      if (e.status !== 'ACTIVE') throw new AppError('WEBHOOK_DISABLED', 'Turn the webhook on first', 409);
      await this.events.emit(tx, tenant.id, 'webhook.test', { endpoint: e.name }, id);
      return { queued: true };
    });
  }

  deliveries(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    q: z.output<typeof deliveryListQuerySchema>,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await this.load(tx, id);
      const rows = await tx.webhookDelivery.findMany({
        where: { endpointId: id, ...(q.status ? { status: q.status } : {}) },
        orderBy: { createdAt: 'desc' },
        take: q.limit,
        select: {
          id: true,
          eventId: true,
          eventType: true,
          status: true,
          attempts: true,
          lastStatusCode: true,
          lastError: true,
          nextAttemptAt: true,
          deliveredAt: true,
          createdAt: true,
        },
      });
      return rows.map((d) => ({
        ...d,
        nextAttemptAt: d.status === 'PENDING' ? d.nextAttemptAt.toISOString() : null,
        deliveredAt: d.deliveredAt?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
      }));
    });
  }

  private async load(tx: TenantTransaction, id: string) {
    const row = await tx.webhookEndpoint.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('Webhook');
    return row;
  }

  private record(
    tx: TenantTransaction,
    tenant: TenantContext,
    auth: AuthContext,
    meta: RequestMeta,
    action: string,
    targetId: string,
    metadata: Record<string, number>,
  ) {
    return this.audit.recordInTransaction(
      tx,
      {
        action,
        outcome: 'SUCCESS',
        tenantId: tenant.id,
        actorUserId: auth.user.id,
        targetType: 'webhook',
        targetId,
        metadata,
      },
      meta,
    );
  }
}
