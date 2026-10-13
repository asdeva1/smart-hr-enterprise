import { QUEUES } from '@smart-hr/shared';

/** Queue names. Each later phase adds its own queue to QUEUES in @smart-hr/shared. */
export const SYSTEM_QUEUE = QUEUES.system;
export const NOTIFICATIONS_QUEUE = QUEUES.notifications;

export const SystemJob = {
  Heartbeat: 'heartbeat',
} as const;

export const WORKER_ENV = Symbol('WORKER_ENV');
export const REDIS = Symbol('REDIS');
/** The nodemailer transport, or null when email delivery is not configured. */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');
