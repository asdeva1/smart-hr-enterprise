import { Inject, Injectable } from '@nestjs/common';
import { withContext, type DatabaseClient, type TenantTransaction } from '@smart-hr/database';
import { NotFoundError } from '@smart-hr/shared';
import type { createApiKeySchema } from '@smart-hr/validation';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { DATABASE } from '../infra/tokens.js';

const KEY_FORMAT = /^shr_([a-z0-9]{8})_([A-Za-z0-9_-]{32,})$/;
const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');

export interface VerifiedKey {
  id: string;
  tenantId: string;
  scopes: string[];
}

/**
 * Keys for outside systems. A key looks like `shr_<prefix>_<secret>`: the prefix finds it, only a hash of the
 * whole key is stored, and the full key is shown once when it is made. Keys are revoked, not deleted.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly audit: AuditService,
  ) {}

  private run<T>(tenant: TenantContext, auth: AuthContext, work: (tx: TenantTransaction) => Promise<T>) {
    return withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, work);
  }

  list(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const rows = await tx.apiKey.findMany({ orderBy: { createdAt: 'desc' } });
      const now = Date.now();
      return rows.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: `shr_${k.prefix}`,
        scopes: k.scopes,
        expiresAt: k.expiresAt?.toISOString() ?? null,
        revokedAt: k.revokedAt?.toISOString() ?? null,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        createdAt: k.createdAt.toISOString(),
        active: !k.revokedAt && (!k.expiresAt || k.expiresAt.getTime() > now),
      }));
    });
  }

  create(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof createApiKeySchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      // Lower-case letters and digits only, so the prefix is easy to read out and can't be confused with the secret.
      const prefix = Array.from(randomBytes(8), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join(
        '',
      );
      const secret = randomBytes(32).toString('base64url');
      const key = `shr_${prefix}_${secret}`;
      const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;
      const row = await tx.apiKey.create({
        data: {
          tenantId: tenant.id,
          name: input.name,
          prefix,
          secretHash: hash(key),
          scopes: input.scopes,
          createdByUserId: auth.user.id,
          expiresAt,
        },
      });
      await this.record(tx, tenant, auth, meta, 'integrations.api_key.create', row.id, {
        scopes: input.scopes.length,
      });
      return {
        id: row.id,
        name: row.name,
        scopes: row.scopes,
        expiresAt: expiresAt?.toISOString() ?? null,
        key,
      };
    });
  }

  revoke(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const existing = await tx.apiKey.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError('API key');
      if (!existing.revokedAt) {
        await tx.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
        await this.record(tx, tenant, auth, meta, 'integrations.api_key.revoke', id, {});
      }
      return { revoked: true };
    });
  }

  /** Checks a presented key. Returns null for anything wrong (unknown, wrong secret, revoked, expired), saying nothing about why. */
  async verify(presented: string): Promise<VerifiedKey | null> {
    const match = KEY_FORMAT.exec(presented);
    if (!match) return null;
    const rows = await this.db.$queryRaw<
      {
        id: string;
        tenant_id: string;
        secret_hash: string;
        scopes: string[];
        expires_at: Date | null;
        revoked_at: Date | null;
      }[]
    >`SELECT * FROM find_api_key(${match[1]!})`;
    const row = rows[0];
    // Compare even when nothing was found, so timing doesn't reveal which prefixes exist.
    const wanted = Buffer.from(row?.secret_hash ?? '0'.repeat(64));
    const given = Buffer.from(hash(presented));
    const same = wanted.length === given.length && timingSafeEqual(wanted, given);
    if (!row || !same || row.revoked_at || (row.expires_at && row.expires_at.getTime() <= Date.now()))
      return null;
    await this.db.$executeRaw`SELECT touch_api_key(${row.id}::uuid)`;
    return { id: row.id, tenantId: row.tenant_id, scopes: row.scopes };
  }

  private record(
    tx: TenantTransaction,
    tenant: TenantContext,
    auth: AuthContext,
    meta: RequestMeta,
    action: string,
    targetId: string,
    metadata: Record<string, number>,
  ) {
    return this.audit.recordInTransaction(
      tx,
      {
        action,
        outcome: 'SUCCESS',
        tenantId: tenant.id,
        actorUserId: auth.user.id,
        targetType: 'api_key',
        targetId,
        metadata,
      },
      meta,
    );
  }
}
