import { withContext, type DatabaseClient, type TenantTransaction } from '@smart-hr/database';
import type { AuthContext } from '../auth/auth.types.js';

/**
 * Runs platform-operator work. Only call from routes guarded by @RequirePlatformAdmin: it marks the
 * transaction as a platform actor, which the database requires before it lets anyone write subscriptions or
 * list organisations. With `tenantId`, the work is also scoped to that one organisation.
 */
export function asPlatform<T>(
  db: DatabaseClient,
  auth: AuthContext,
  work: (tx: TenantTransaction) => Promise<T>,
  tenantId?: string,
): Promise<T> {
  return withContext(db, { userId: auth.user.id, tenantId: tenantId ?? null, platformActor: true }, work);
}
