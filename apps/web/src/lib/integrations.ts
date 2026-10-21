export type WebhookStatus = 'ACTIVE' | 'DISABLED';

export interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  status: WebhookStatus;
  failureStreak: number;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  eventId: string;
  eventType: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  active: boolean;
}

export interface IntegrationOptions {
  events: string[];
  scopes: string[];
}

export const integrationKeys = {
  options: ['integrations', 'options'] as const,
  webhooks: ['integrations', 'webhooks'] as const,
  deliveries: (id: string) => ['integrations', 'webhooks', id, 'deliveries'] as const,
  keys: ['integrations', 'api-keys'] as const,
};

export const EVENT_LABEL: Record<string, string> = {
  'employee.created': 'A person is added',
  'employee.status_changed': 'A person’s employment status changes (notice, exit, return)',
  'leave.request.approved': 'Leave is approved',
  'operations.item.created': 'A work item is raised',
  'webhook.test': 'Test event',
};

export const SCOPE_LABEL: Record<string, string> = {
  'employees.read': 'Read the employee directory (names, codes, work email, department)',
};

export const DELIVERY_TONE = { PENDING: 'warning', SENT: 'success', FAILED: 'danger' } as const;
