import { PrismaPg } from '@prisma/adapter-pg';
import { isUuid } from '@smart-hr/shared';
import { Prisma, PrismaClient } from './generated/client.js';

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
  return withContext(db, { tenantId }, work);
}

export interface DatabaseContext {
  /** Active tenant, from the authenticated session. */
  tenantId?: string | null;
  /** Signed-in user, from the authenticated session. */
  userId?: string | null;
}

/**
 * Like `withTenant`, but can also carry the signed-in user (`app.user_id`), which some policies use —
 * for example to let a user list their own memberships before choosing a tenant.
 * Both values must be UUIDs from the authenticated session.
 */
export async function withContext<T>(
  db: DatabaseClient,
  context: DatabaseContext,
  work: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  const tenantId = context.tenantId ?? null;
  const userId = context.userId ?? null;
  if ((tenantId !== null && !isUuid(tenantId)) || (userId !== null && !isUuid(userId))) {
    throw new InvalidTenantContextError();
  }
  if (tenantId === null && userId === null) {
    throw new InvalidTenantContextError();
  }
  return db.$transaction(async (tx) => {
    if (tenantId !== null) {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    }
    if (userId !== null) {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    }
    return work(tx);
  });
}

/** True when a write failed on a unique constraint (Prisma P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** True when a write failed on a foreign key (Prisma P2003) — for tenant-qualified keys, a cross-tenant reference. */
export function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}

/** Cheap connectivity probe for readiness checks. */
export async function pingDatabase(db: DatabaseClient): Promise<void> {
  await db.$queryRaw`SELECT 1`;
}
