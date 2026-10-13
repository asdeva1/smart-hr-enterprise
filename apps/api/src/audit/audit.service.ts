import { Inject, Injectable } from '@nestjs/common';
import { hashToken } from '@smart-hr/auth';
import {
  withContext,
  type AuditOutcome,
  type DatabaseClient,
  type TenantTransaction,
} from '@smart-hr/database';
import { Logger } from 'nestjs-pino';
import type { RequestMeta } from '../common/request-context.js';
import { DATABASE } from '../infra/tokens.js';

export interface AuditEntry {
  action: string;
  outcome: AuditOutcome;
  tenantId?: string | null;
  actorUserId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/** Keys that must never reach the audit log, at any depth. */
const FORBIDDEN_KEY = /pass(word)?|token|secret|otp|code|authorization|cookie|session/i;

export function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitizeMetadata(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !FORBIDDEN_KEY.test(key))
        .map(([key, v]) => [key, sanitizeMetadata(v, depth + 1)]),
    );
  }
  if (typeof value === 'string') return value.slice(0, 500);
  return value;
}

/** Correlates attempts against the same unknown email without storing what was typed. */
export function emailFingerprint(email: string): string {
  return hashToken(`audit-email:${email}`).slice(0, 16);
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly logger: Logger,
  ) {}

  /**
   * Writes one append-only audit event. Audit failures are logged loudly but never break the user's
   * request — except that callers performing security-critical changes write inside their own transaction.
   */
  private toRow(entry: AuditEntry, meta: RequestMeta) {
    return {
      action: entry.action,
      outcome: entry.outcome,
      tenantId: entry.tenantId ?? null,
      actorUserId: entry.actorUserId ?? null,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      metadata: sanitizeMetadata(entry.metadata ?? {}) as object,
    };
  }

  /**
   * Writes the event inside the caller's tenant transaction, so the change and its audit record commit or
   * roll back together. Use for permission, role, membership and security-policy changes.
   */
  async recordInTransaction(tx: TenantTransaction, entry: AuditEntry, meta: RequestMeta): Promise<void> {
    await tx.auditEvent.createMany({ data: [this.toRow(entry, meta)] });
  }

  async record(entry: AuditEntry, meta: RequestMeta): Promise<void> {
    const data = this.toRow(entry, meta);
    try {
      // createMany issues a plain INSERT without RETURNING. `create` would read the row back, which the
      // read policy rightly refuses for events the current context may not see (e.g. a failed sign-in).
      if (data.tenantId) {
        await withContext(this.db, { tenantId: data.tenantId, userId: data.actorUserId }, (tx) =>
          tx.auditEvent.createMany({ data: [data] }),
        );
      } else {
        // Platform-level event: the insert policy allows tenant_id IS NULL without context.
        await this.db.auditEvent.createMany({ data: [data] });
      }
    } catch (error) {
      this.logger.error({ err: error, action: entry.action }, 'audit write failed');
    }
  }
}
