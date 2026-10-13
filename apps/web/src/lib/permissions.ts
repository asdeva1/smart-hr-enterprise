import type { SessionView } from './api';

/**
 * Whether the signed-in member holds a permission anywhere in the active organisation.
 * Only decides what to show; the API enforces every permission (and its scope) on each request.
 */
export function can(session: SessionView, permission: string): boolean {
  return session.activeTenant?.permissions.includes(permission) ?? false;
}
