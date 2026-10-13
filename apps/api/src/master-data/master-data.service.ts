import { Inject, Injectable } from '@nestjs/common';
import {
  isUniqueViolation,
  withContext,
  type DatabaseClient,
  type TenantTransaction,
} from '@smart-hr/database';
import {
  AppError,
  ForbiddenError,
  isMasterDataList,
  MASTER_DATA_LISTS,
  NotFoundError,
  type MasterDataList,
} from '@smart-hr/shared';
import type { createLookupValueSchema, updateLookupValueSchema } from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { DATABASE } from '../infra/tokens.js';

const VALUE = {
  id: true,
  list: true,
  code: true,
  name: true,
  description: true,
  sortOrder: true,
  status: true,
  updatedAt: true,
} as const;

/**
 * The organisation's reference lists. Reading needs only membership (forms everywhere use them);
 * changing needs master_data.manage for the whole organisation. Values are archived, never deleted.
 */
@Injectable()
export class MasterDataService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly audit: AuditService,
  ) {}

  private run<T>(tenant: TenantContext, auth: AuthContext, work: (tx: TenantTransaction) => Promise<T>) {
    return withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, work);
  }

  private listOf(list: string): MasterDataList {
    if (!isMasterDataList(list)) throw new NotFoundError('List');
    return list;
  }

  private requireManage(tenant: TenantContext) {
    if (!tenant.permissions.allowsTenantWide('master_data.manage')) throw new ForbiddenError();
  }

  private record(
    tx: TenantTransaction,
    tenant: TenantContext,
    auth: AuthContext,
    action: string,
    id: string,
    metadata: Record<string, unknown>,
    meta: RequestMeta,
  ) {
    return this.audit.recordInTransaction(
      tx,
      {
        action,
        outcome: 'SUCCESS',
        tenantId: tenant.id,
        actorUserId: auth.user.id,
        targetType: 'lookup_value',
        targetId: id,
        metadata,
      },
      meta,
    );
  }

  async catalogue(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const counts = await tx.lookupValue.groupBy({ by: ['list', 'status'], _count: { _all: true } });
      const codes = await tx.lookupValue.findMany({ select: { list: true, code: true } });
      return Object.entries(MASTER_DATA_LISTS).map(([list, def]) => {
        const count = (status: 'ACTIVE' | 'ARCHIVED') =>
          counts.find((c) => c.list === list && c.status === status)?._count._all ?? 0;
        const existing = new Set(codes.filter((c) => c.list === list).map((c) => c.code));
        return {
          list,
          label: def.label,
          description: def.description,
          usedBy: def.usedBy,
          active: count('ACTIVE'),
          archived: count('ARCHIVED'),
          suggestionsAvailable: def.suggestions.filter((s) => !existing.has(s.code)).length,
        };
      });
    });
  }

  async values(tenant: TenantContext, auth: AuthContext, list: string, includeArchived: boolean) {
    const key = this.listOf(list);
    return this.run(tenant, auth, (tx) =>
      tx.lookupValue.findMany({
        where: { list: key, ...(includeArchived ? {} : { status: 'ACTIVE' }) },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: VALUE,
      }),
    );
  }

  async create(
    tenant: TenantContext,
    auth: AuthContext,
    list: string,
    input: z.output<typeof createLookupValueSchema>,
    meta: RequestMeta,
  ) {
    const key = this.listOf(list);
    this.requireManage(tenant);
    try {
      return await this.run(tenant, auth, async (tx) => {
        const value = await tx.lookupValue.create({
          data: {
            tenantId: tenant.id,
            list: key,
            code: input.code,
            name: input.name,
            description: input.description ?? null,
            sortOrder: input.sortOrder,
          },
          select: VALUE,
        });
        await this.record(
          tx,
          tenant,
          auth,
          'master_data.value.create',
          value.id,
          { list: key, code: value.code },
          meta,
        );
        return value;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError('CODE_TAKEN', 'That code is already used in this list', 409, [
          { path: 'code', message: 'Already used in this list (archived values keep their code)' },
        ]);
      }
      throw error;
    }
  }

  async update(
    tenant: TenantContext,
    auth: AuthContext,
    list: string,
    id: string,
    input: z.output<typeof updateLookupValueSchema>,
    meta: RequestMeta,
  ) {
    const key = this.listOf(list);
    this.requireManage(tenant);
    return this.run(tenant, auth, async (tx) => {
      const existing = await tx.lookupValue.findFirst({ where: { id, list: key }, select: VALUE });
      if (!existing) throw new NotFoundError('Value');
      const value = await tx.lookupValue.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
        select: VALUE,
      });
      const action =
        input.status && input.status !== existing.status
          ? input.status === 'ARCHIVED'
            ? 'master_data.value.archive'
            : 'master_data.value.restore'
          : 'master_data.value.update';
      await this.record(tx, tenant, auth, action, id, { list: key, code: existing.code }, meta);
      return value;
    });
  }

  /** Adds the list's suggested values that aren't there yet (by code). Never touches existing values. */
  async addSuggestions(tenant: TenantContext, auth: AuthContext, list: string, meta: RequestMeta) {
    const key = this.listOf(list);
    this.requireManage(tenant);
    return this.run(tenant, auth, async (tx) => {
      const existing = new Set(
        (await tx.lookupValue.findMany({ where: { list: key }, select: { code: true } })).map((v) => v.code),
      );
      const missing = MASTER_DATA_LISTS[key].suggestions.filter((s) => !existing.has(s.code));
      if (missing.length === 0) return { added: 0 };
      const result = await tx.lookupValue.createMany({
        data: missing.map((s, i) => ({
          tenantId: tenant.id,
          list: key,
          code: s.code,
          name: s.name,
          sortOrder: (i + 1) * 10,
        })),
        skipDuplicates: true,
      });
      await this.record(
        tx,
        tenant,
        auth,
        'master_data.suggestions.add',
        tenant.id,
        { list: key, added: result.count },
        meta,
      );
      return { added: result.count };
    });
  }
}
