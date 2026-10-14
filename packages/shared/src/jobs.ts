/** Queue names and job payloads shared by the API (producer) and the worker (consumer). */

export const QUEUES = {
  system: 'system',
  notifications: 'notifications',
} as const;

export const NotificationJob = {
  Email: 'email.send',
  /** Repeating: delivers emails waiting in the notification outbox. */
  OutboxSweep: 'email.outbox-sweep',
  /** Repeating: notifies people about overdue approval tasks. */
  EscalationSweep: 'approvals.escalation-sweep',
  /** Repeating: records subscriptions whose trial or period (plus grace) has run out, and tells owners. */
  SubscriptionExpirySweep: 'subscriptions.expiry-sweep',
} as const;

export interface EmailJobData {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Category for logs and metrics, e.g. `password_reset`. Never the content. */
  category: string;
}
