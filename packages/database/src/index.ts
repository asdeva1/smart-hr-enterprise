import { PrismaPg } from '@prisma/adapter-pg';
import { isUuid } from '@smart-hr/shared';
import { PrismaClient, type Prisma } from './generated/client.js';

export * from './generated/client.js';

export type DatabaseClient = PrismaClient;
export type TenantTransaction = Prisma.TransactionClient;

export interface CreateDatabaseClientOptions {
  connectionString: string;
  /** Maximum pooled connections per process. */
  maxConnections?: number;
}

export function createDatabaseClient({ connectionString, maxConnections = 10 }: CreateDatabaseClientOptions) {
  const adapter = new PrismaPg({ connectionString, max: maxConnections });
  return new PrismaClient({ adapter });
}

export class InvalidTenantContextError extends Error {
  constructor() {
    super('Tenant context must be a UUID taken from the authenticated session');
    this.name = 'InvalidTenantContextError';
  }
}

/**
 * Runs `work` inside one transaction with `app.tenant_id` set for row-level security.
 *
 * The setting is transaction-local (`set_config(..., true)`), so it can never leak to another
 * request that later reuses the same pooled connection. The tenant id must come from the
 * authenticated server-side session — never from a request body, query string or header.
 */
export async function withTenant<T>(
  db: DatabaseClient,
  tenantId: string,
  work: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  if (!isUuid(tenantId)) {
    throw new InvalidTenantContextError();
  }
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return work(tx);
  });
}

/** Cheap connectivity probe for readiness checks. */
export async function pingDatabase(db: DatabaseClient): Promise<void> {
  await db.$queryRaw`SELECT 1`;
}
