import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '@smart-hr/database';
import { randomUUID } from 'node:crypto';
import type { WebhookEvent } from '@smart-hr/validation';

/**
 * Queues an event for every active endpoint that asked for it. Called inside the transaction that made the
 * change, so an event exists exactly when the change does. Payloads carry ids and a few plain fields, never
 * personal or financial detail; the receiver can ask for more with an API key.
 */
@Injectable()
export class WebhookEventsService {
  async emit(
    tx: TenantTransaction,
    tenantId: string,
    type: WebhookEvent | 'webhook.test',
    data: Record<string, string | number | boolean | null>,
    onlyEndpointId?: string,
  ): Promise<number> {
    const endpoints = await tx.webhookEndpoint.findMany({
      where: {
        status: 'ACTIVE',
        ...(onlyEndpointId ? { id: onlyEndpointId } : { events: { has: type } }),
      },
      select: { id: true },
    });
    if (endpoints.length === 0) return 0;
    const eventId = randomUUID();
    const payload = { id: eventId, type, createdAt: new Date().toISOString(), data };
    await tx.webhookDelivery.createMany({
      data: endpoints.map((e) => ({
        tenantId,
        endpointId: e.id,
        eventId,
        eventType: type,
        payload,
      })),
    });
    return endpoints.length;
  }
}
