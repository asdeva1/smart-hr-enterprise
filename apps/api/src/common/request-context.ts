import type { Request } from 'express';
import type { AuthContext } from '../auth/auth.types.js';

/** Request facts recorded with audit events. Never includes headers wholesale. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export type AppRequest = Request & { id?: string; auth?: AuthContext };

export function requestMeta(req: AppRequest): RequestMeta {
  const ua = req.headers['user-agent'];
  return {
    ip: req.ip ?? null,
    userAgent: typeof ua === 'string' ? ua.slice(0, 256) : null,
    requestId: typeof req.id === 'string' ? req.id : null,
  };
}
