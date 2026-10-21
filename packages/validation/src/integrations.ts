import { z } from 'zod';

/** Events an organisation can send to its own systems. */
export const WEBHOOK_EVENTS = [
  'employee.created',
  'employee.status_changed',
  'leave.request.approved',
  'operations.item.created',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** What an API key can be allowed to do. */
export const API_KEY_SCOPES = ['employees.read'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/**
 * True for host names and addresses that must never be called from the server: loopback, private and
 * link-local ranges, cloud metadata addresses and names that are only meaningful inside a network. Delivery
 * checks the resolved address again; this catches the obvious cases when the address is entered.
 */
export function isBlockedHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return true;
  if (!host.includes('.') && !host.includes(':')) return true;
  return isBlockedAddress(host);
}

/** True when `address` is an IP literal in a range that isn't on the public internet. */
export function isBlockedAddress(address: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return true;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (address.includes(':')) {
    const a = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped) return isBlockedAddress(mapped[1]!);
    return (
      a === '::' ||
      a === '::1' ||
      a.startsWith('fc') ||
      a.startsWith('fd') ||
      a.startsWith('fe8') ||
      a.startsWith('fe9') ||
      a.startsWith('fea') ||
      a.startsWith('feb') ||
      a.startsWith('ff') ||
      a.startsWith('::ffff:')
    );
  }
  return false;
}

const webhookUrl = z
  .url('Enter a full address')
  .max(500)
  .refine((u) => u.toLowerCase().startsWith('https://'), 'The address must start with https://')
  .refine((u) => {
    try {
      const url = new URL(u);
      return !url.username && !url.password && !isBlockedHost(url.hostname);
    } catch {
      return false;
    }
  }, 'Use a public address without a user name or password');

const events = z
  .array(z.enum(WEBHOOK_EVENTS))
  .min(1, 'Choose at least one event')
  .transform((list) => [...new Set(list)]);

export const createWebhookSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(80),
  url: webhookUrl,
  events,
});

export const updateWebhookSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    url: webhookUrl.optional(),
    events: events.optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(80),
  scopes: z
    .array(z.enum(API_KEY_SCOPES))
    .min(1, 'Choose at least one permission')
    .transform((list) => [...new Set(list)]),
  /** Days until the key stops working. Left out, it doesn't expire. */
  expiresInDays: z.coerce.number().int().min(1).max(730).optional(),
});

export const deliveryListQuerySchema = z.object({
  status: z.enum(['PENDING', 'SENT', 'FAILED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
