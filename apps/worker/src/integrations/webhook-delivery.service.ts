import { Inject, Injectable, Logger } from '@nestjs/common';
import { SecretBox } from '@smart-hr/auth';
import type { DatabaseClient } from '@smart-hr/database';
import { isBlockedAddress } from '@smart-hr/validation';
import { createHmac } from 'node:crypto';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { parseKeyRing, type WorkerEnv } from '../config/env.js';
import { DATABASE, WORKER_ENV } from '../queues.js';

interface Claimed {
  id: string;
  tenant_id: string;
  endpoint_id: string;
  event_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
  url: string;
  secret_enc: string;
}

export interface WebhookSweepResult {
  claimed: number;
  sent: number;
  failed: number;
}

const BATCH = 50;
const RECLAIM_AFTER_SECONDS = 300;

/** What the receiver verifies: HMAC-SHA256 over `<event id>.<timestamp>.<body>`, sent as `v1,<hex>`. */
export function signWebhook(secret: string, eventId: string, timestamp: number, body: string): string {
  return `v1,${createHmac('sha256', secret).update(`${eventId}.${timestamp}.${body}`).digest('hex')}`;
}

/**
 * Sends queued events to the endpoints that asked for them, across organisations (rows are claimed with
 * SKIP LOCKED, like the email outbox). Addresses are checked when connecting, not only when entered, so a name
 * that later points at a private address is refused. Redirects are not followed, and the receiver's reply
 * body is never read or stored. Logs carry ids only.
 */
@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);
  private readonly box: SecretBox | null;

  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
  ) {
    this.box =
      env.DATA_ENCRYPTION_KEYS && env.DATA_ENCRYPTION_KEY_ID
        ? new SecretBox(parseKeyRing(env.DATA_ENCRYPTION_KEYS), env.DATA_ENCRYPTION_KEY_ID)
        : null;
  }

  async sweep(): Promise<WebhookSweepResult> {
    // Without the key ring the secrets can't be read; leave events queued rather than burning attempts.
    if (!this.box) return { claimed: 0, sent: 0, failed: 0 };
    const rows = await this.db.$queryRaw<Claimed[]>`
      SELECT * FROM claim_webhook_deliveries(${BATCH}::int, ${RECLAIM_AFTER_SECONDS}::int)`;
    let sent = 0;
    let failed = 0;
    for (const row of rows) {
      const outcome = await this.deliver(row);
      if (outcome.ok) sent++;
      else failed++;
      await this.db.$executeRaw`
        SELECT complete_webhook_delivery(${row.id}::uuid, ${outcome.ok}, ${outcome.status}::int, ${outcome.error},
                                         ${this.env.WEBHOOK_MAX_ATTEMPTS}::int, ${this.env.WEBHOOK_DISABLE_AFTER}::int)`;
    }
    if (rows.length > 0) this.logger.log(`Webhooks: ${sent} sent, ${failed} failed`);
    return { claimed: rows.length, sent, failed };
  }

  private async deliver(row: Claimed): Promise<{ ok: boolean; status: number | null; error: string | null }> {
    try {
      const secret = this.box!.decrypt(row.secret_enc, `webhook-secret:${row.tenant_id}:${row.endpoint_id}`);
      const body = JSON.stringify(row.payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const status = await this.post(row.url, body, {
        'content-type': 'application/json',
        'user-agent': 'SmartHR-Webhooks/1',
        'webhook-id': row.event_id,
        'webhook-timestamp': String(timestamp),
        'webhook-signature': signWebhook(secret, row.event_id, timestamp, body),
      });
      return status >= 200 && status < 300
        ? { ok: true, status, error: null }
        : { ok: false, status, error: `The receiver answered ${status}` };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      this.logger.warn(`Webhook delivery ${row.id} failed`);
      return { ok: false, status: null, error: message.slice(0, 200) };
    }
  }

  private post(rawUrl: string, body: string, headers: Record<string, string>): Promise<number> {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') return Promise.reject(new Error('Only https addresses are allowed'));
    const allowPrivate = this.env.WEBHOOK_ALLOW_PRIVATE_HOSTS;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!allowPrivate && isIP(host) && isBlockedAddress(host))
      return Promise.reject(new Error('That address is not allowed'));

    return new Promise<number>((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'POST',
          headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) },
          timeout: this.env.WEBHOOK_TIMEOUT_MS,
          // Resolved here so the address that is checked is the address that is connected to.
          lookup: (hostname, options, callback) => {
            dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
              const list = addresses as LookupAddress[] | undefined;
              if (err || !list || list.length === 0) return callback(err ?? new Error('No address'), '', 4);
              if (!allowPrivate && list.some((a) => isBlockedAddress(a.address)))
                return callback(new Error('That address is not allowed'), '', 4);
              if ((options as { all?: boolean }).all) {
                return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
              }
              return callback(null, list[0]!.address, list[0]!.family);
            });
          },
        },
        (res) => {
          // The reply is not needed; drop it without reading.
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('timeout', () => req.destroy(new Error('The receiver took too long to answer')));
      req.on('error', (e) => reject(e));
      req.end(body);
    });
  }
}
