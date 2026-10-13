/** Queue names. Each later phase adds its own queue here (notifications, payroll, documents, ai). */
export const SYSTEM_QUEUE = 'system';

export const SystemJob = {
  Heartbeat: 'heartbeat',
} as const;

export const WORKER_ENV = Symbol('WORKER_ENV');
export const REDIS = Symbol('REDIS');
