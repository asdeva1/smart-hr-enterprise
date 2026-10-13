/** Queue names and job payloads shared by the API (producer) and the worker (consumer). */

export const QUEUES = {
  system: 'system',
  notifications: 'notifications',
} as const;

export const NotificationJob = {
  Email: 'email.send',
} as const;

export interface EmailJobData {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Category for logs and metrics, e.g. `password_reset`. Never the content. */
  category: string;
}
