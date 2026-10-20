import { Injectable } from '@nestjs/common';
import { isUniqueViolation, type Prisma, type TenantTransaction } from '@smart-hr/database';
import { AppError, ForbiddenError, NotFoundError, type ScopeRef } from '@smart-hr/shared';
import type {
  definitionSchema,
  opsCommentSchema,
  opsItemListQuerySchema,
  opsItemSchema,
  opsTransitionSchema,
  updateOpsItemSchema,
  updateWorkspaceSchema,
  workspaceSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { AttendanceService, toDate } from '../attendance/attendance.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { displayName } from '../employees/employees.service.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { DEFAULT_DEFINITION, OPERATIONS_TEMPLATES } from './templates.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);

const companyScopes = (tenantId: string, companyId: string): ScopeRef[] => [
  { type: 'TENANT', id: tenantId },
  { type: 'COMPANY', id: companyId },
];

function invalid(path: string, message: string) {
  return new AppError('VALIDATION_FAILED', message, 400, [{ path, message }]);
}

type Level = 'none' | 'view' | 'contribute' | 'manage';
type Values = Record<string, string | number | boolean | null>;
type Definition = z.output<typeof definitionSchema>;

type ItemRow = Prisma.OpsItemGetPayload<{
  include: {
    stage: true;
    assignee: { select: { id: true; firstName: true; lastName: true; preferredName: true } };
    workspace: { select: { prefix: true; name: true; code: true } };
  };
}>;

const itemInclude = {
  stage: true,
  assignee: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
  workspace: { select: { prefix: true, name: true, code: true } },
} as const;

/**
 * Operations workspaces: places to track work that each organisation shapes for itself. A workspace has its own
 * stages and extra fields (from a template or set up by hand), and holds items with an owner, a priority, a
 * due date and a history that only ever grows.
 */
@Injectable()
export class OperationsService {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {
    // Archived workspaces don't count towards the plan's limit.
    entitlements.registerUsage('operations.workspaces.max', (tx) =>
      tx.opsWorkspace.count({ where: { status: 'ACTIVE' } }),
    );
  }

  private run<T>(tenant: TenantContext, auth: AuthContext, work: (tx: TenantTransaction) => Promise<T>) {
    return this.attendance.run(tenant, auth, work);
  }

  private record(
    tx: TenantTransaction,
    tenant: TenantContext,
    auth: AuthContext,
    action: string,
    targetType: string,
    targetId: string,
    meta: RequestMeta,
    metadata: Record<string, string | number> = {},
  ) {
    return this.audit.recordInTransaction(
      tx,
      {
        action,
        outcome: 'SUCCESS',
        tenantId: tenant.id,
        actorUserId: auth.user.id,
        targetType,
        targetId,
        metadata,
      },
      meta,
    );
  }

  private level(tenant: TenantContext, companyId: string): Level {
    const scopes = companyScopes(tenant.id, companyId);
    if (tenant.permissions.allows('operations.manage', scopes)) return 'manage';
    if (tenant.permissions.allows('operations.contribute', scopes)) return 'contribute';
    if (tenant.permissions.allows('operations.view', scopes)) return 'view';
    return 'none';
  }

  private async selfId(tx: TenantTransaction, tenant: TenantContext) {
    return (await this.attendance.self(tx, tenant))?.id ?? null;
  }

  // ---- Templates and workspaces -----------------------------------------------------------------

  templates() {
    return OPERATIONS_TEMPLATES.map((t) => ({
      key: t.key,
      name: t.name,
      description: t.description,
      stages: t.definition.stages.map((s) => s.label),
      fields: t.definition.fields.map((f) => f.label),
    }));
  }

  private workspaceView(
    w: Prisma.OpsWorkspaceGetPayload<object>,
    level: Level,
    counts?: Map<string, number>,
  ) {
    return {
      id: w.id,
      companyId: w.companyId,
      code: w.code,
      name: w.name,
      description: w.description,
      template: w.template,
      prefix: w.prefix,
      status: w.status,
      level,
      openItems: counts?.get(w.id) ?? 0,
    };
  }

  list(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const rows = await tx.opsWorkspace.findMany({ orderBy: { name: 'asc' } });
      const visible = rows
        .map((w) => ({ w, level: this.level(tenant, w.companyId) }))
        .filter((x) => x.level !== 'none');
      const open = await tx.opsItem.groupBy({
        by: ['workspaceId'],
        where: { workspaceId: { in: visible.map((x) => x.w.id) }, stage: { kind: 'OPEN' } },
        _count: { _all: true },
      });
      const counts = new Map(open.map((o) => [o.workspaceId, o._count._all]));
      return visible.map((x) => this.workspaceView(x.w, x.level, counts));
    });
  }

  async create(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof workspaceSchema>,
    meta: RequestMeta,
  ) {
    if (this.level(tenant, input.companyId) !== 'manage') throw new ForbiddenError();
    const template = input.template ? OPERATIONS_TEMPLATES.find((t) => t.key === input.template) : null;
    if (input.template && !template) throw invalid('template', 'Choose one of the templates');
    return this.run(tenant, auth, async (tx) => {
      if (!template) {
        this.entitlements.assertFeature(await this.entitlements.forTenant(tx), 'operations.custom', true);
      }
      await this.entitlements.assertWithinLimit(tx, 'operations.workspaces.max');
      const company = await tx.company.findUnique({ where: { id: input.companyId }, select: { id: true } });
      if (!company) throw invalid('companyId', 'Choose a company');
      const definition = template?.definition ?? DEFAULT_DEFINITION;
      try {
        const w = await tx.opsWorkspace.create({
          data: {
            tenantId: tenant.id,
            companyId: input.companyId,
            code: input.code.toUpperCase(),
            name: input.name,
            description: input.description ?? null,
            template: template?.key ?? null,
            prefix:
              (template?.prefix ??
                input.code
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, '')
                  .slice(0, 6)) ||
              'OPS',
          },
        });
        await this.writeDefinition(tx, tenant.id, w.id, definition);
        await this.record(tx, tenant, auth, 'operations.workspace.create', 'ops_workspace', w.id, meta);
        return this.workspaceView(w, 'manage');
      } catch (error) {
        if (isUniqueViolation(error)) throw invalid('code', 'That workspace code is already in use');
        throw error;
      }
    });
  }

  private async writeDefinition(tx: TenantTransaction, tenantId: string, workspaceId: string, d: Definition) {
    await tx.opsStage.createMany({
      data: d.stages.map((s, position) => ({
        tenantId,
        workspaceId,
        key: s.key,
        label: s.label,
        kind: s.kind,
        position,
      })),
    });
    await tx.opsField.createMany({
      data: d.fields.map((f, position) => ({
        tenantId,
        workspaceId,
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required,
        ...(f.options ? { options: f.options } : {}),
        position,
      })),
    });
  }

  private async workspaceFor(tx: TenantTransaction, tenant: TenantContext, id: string, need: Level) {
    const w = await tx.opsWorkspace.findUnique({ where: { id } });
    if (!w) throw new NotFoundError('Workspace');
    const level = this.level(tenant, w.companyId);
    const rank = { none: 0, view: 1, contribute: 2, manage: 3 } as const;
    if (rank[level] === 0) throw new NotFoundError('Workspace');
    if (rank[level] < rank[need]) throw new ForbiddenError();
    return { w, level };
  }

  detail(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, async (tx) => {
      const { w, level } = await this.workspaceFor(tx, tenant, id, 'view');
      const [stages, fields, counts] = await Promise.all([
        tx.opsStage.findMany({ where: { workspaceId: id }, orderBy: { position: 'asc' } }),
        tx.opsField.findMany({ where: { workspaceId: id }, orderBy: { position: 'asc' } }),
        tx.opsItem.groupBy({ by: ['stageId'], where: { workspaceId: id }, _count: { _all: true } }),
      ]);
      const perStage = new Map(counts.map((c) => [c.stageId, c._count._all]));
      return {
        ...this.workspaceView(w, level),
        stages: stages.map((s) => ({
          id: s.id,
          key: s.key,
          label: s.label,
          kind: s.kind,
          items: perStage.get(s.id) ?? 0,
        })),
        fields: fields.map((f) => ({
          key: f.key,
          label: f.label,
          type: f.type,
          required: f.required,
          options: (f.options as string[] | null) ?? [],
        })),
      };
    });
  }

  update(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateWorkspaceSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const { w } = await this.workspaceFor(tx, tenant, id, 'manage');
      if (input.status === 'ACTIVE' && w.status === 'ARCHIVED') {
        await this.entitlements.assertWithinLimit(tx, 'operations.workspaces.max');
      }
      const data: Prisma.OpsWorkspaceUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.description !== undefined) data.description = input.description;
      if (input.status !== undefined) data.status = input.status;
      const updated = await tx.opsWorkspace.update({ where: { id }, data });
      await this.record(tx, tenant, auth, 'operations.workspace.update', 'ops_workspace', id, meta);
      return this.workspaceView(updated, 'manage');
    });
  }

  /** Replaces a workspace's stages and fields. A stage that holds items can't be dropped. */
  setDefinition(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof definitionSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      this.entitlements.assertFeature(await this.entitlements.forTenant(tx), 'operations.custom', true);
      await this.workspaceFor(tx, tenant, id, 'manage');
      const existing = await tx.opsStage.findMany({ where: { workspaceId: id } });
      const keys = new Set(input.stages.map((s) => s.key));
      for (const s of existing.filter((e) => !keys.has(e.key))) {
        const used = await tx.opsItem.count({ where: { stageId: s.id } });
        if (used > 0) {
          throw new AppError(
            'STAGE_IN_USE',
            `“${s.label}” still has ${used} item(s), so it can’t be removed`,
            409,
          );
        }
      }
      await tx.opsStage.deleteMany({ where: { workspaceId: id, key: { notIn: [...keys] } } });
      // Positions are unique to nothing, so existing stages are updated in place and new ones added.
      for (const [position, s] of input.stages.entries()) {
        const found = existing.find((e) => e.key === s.key);
        if (found) {
          await tx.opsStage.update({
            where: { id: found.id },
            data: { label: s.label, kind: s.kind, position },
          });
        } else {
          await tx.opsStage.create({
            data: {
              tenantId: tenant.id,
              workspaceId: id,
              key: s.key,
              label: s.label,
              kind: s.kind,
              position,
            },
          });
        }
      }
      await tx.opsField.deleteMany({ where: { workspaceId: id } });
      await tx.opsField.createMany({
        data: input.fields.map((f, position) => ({
          tenantId: tenant.id,
          workspaceId: id,
          key: f.key,
          label: f.label,
          type: f.type,
          required: f.required,
          ...(f.options ? { options: f.options } : {}),
          position,
        })),
      });
      await this.record(tx, tenant, auth, 'operations.workspace.define', 'ops_workspace', id, meta, {
        stages: input.stages.length,
        fields: input.fields.length,
      });
      return { stages: input.stages.length, fields: input.fields.length };
    });
  }

  // ---- Items -------------------------------------------------------------------------------------

  private itemView(i: ItemRow) {
    const today = iso(new Date());
    return {
      id: i.id,
      workspaceId: i.workspaceId,
      workspace: { name: i.workspace.name, code: i.workspace.code },
      ref: `${i.workspace.prefix}-${String(i.number).padStart(4, '0')}`,
      number: i.number,
      title: i.title,
      description: i.description,
      stage: { id: i.stage.id, key: i.stage.key, label: i.stage.label, kind: i.stage.kind },
      priority: i.priority,
      assignee: i.assignee ? { id: i.assignee.id, name: displayName(i.assignee) } : null,
      dueDate: i.dueDate ? iso(i.dueDate) : null,
      overdue: !!i.dueDate && iso(i.dueDate) < today && i.stage.kind === 'OPEN',
      values: i.values as Values,
      createdAt: i.createdAt.toISOString(),
      completedAt: i.completedAt ? i.completedAt.toISOString() : null,
    };
  }

  /** Checks answers against the workspace's fields: known keys, the right type, a listed choice, required ones present. */
  private async checkValues(
    tx: TenantTransaction,
    workspaceId: string,
    values: Values,
    requireAll: boolean,
  ): Promise<Values> {
    const fields = await tx.opsField.findMany({ where: { workspaceId } });
    const byKey = new Map(fields.map((f) => [f.key, f]));
    const clean: Values = {};
    for (const [key, raw] of Object.entries(values)) {
      const f = byKey.get(key);
      if (!f) throw invalid(`values.${key}`, 'That question isn’t part of this workspace');
      if (raw === null || raw === '') continue;
      const path = `values.${key}`;
      switch (f.type) {
        case 'TEXT':
          if (typeof raw !== 'string') throw invalid(path, 'Enter text');
          clean[key] = raw;
          break;
        case 'NUMBER':
          if (typeof raw === 'boolean' || Number.isNaN(Number(raw))) throw invalid(path, 'Enter a number');
          clean[key] = Number(raw);
          break;
        case 'BOOLEAN':
          if (typeof raw !== 'boolean') throw invalid(path, 'Choose yes or no');
          clean[key] = raw;
          break;
        case 'DATE':
          if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw))
            throw invalid(path, 'Enter a date');
          clean[key] = raw;
          break;
        case 'SELECT':
          if (typeof raw !== 'string' || !((f.options as string[] | null) ?? []).includes(raw)) {
            throw invalid(path, 'Choose one of the listed options');
          }
          clean[key] = raw;
          break;
      }
    }
    if (requireAll) {
      for (const f of fields.filter((x) => x.required)) {
        if (clean[f.key] === undefined) throw invalid(`values.${f.key}`, `${f.label} is required`);
      }
    }
    return clean;
  }

  private async requireAssignee(tx: TenantTransaction, id: string | null | undefined) {
    if (!id) return;
    const e = await tx.employee.findUnique({ where: { id }, select: { status: true } });
    if (!e || e.status === 'EXITED') throw invalid('assigneeId', 'Choose a current employee');
  }

  private event(
    tx: TenantTransaction,
    tenant: TenantContext,
    auth: AuthContext,
    itemId: string,
    kind: 'CREATED' | 'EDITED' | 'STAGE' | 'ASSIGNED' | 'COMMENT',
    body: string | null,
    data?: Prisma.InputJsonValue,
  ) {
    return tx.opsItemEvent.create({
      data: {
        tenantId: tenant.id,
        itemId,
        kind,
        actorUserId: auth.user.id,
        actorName: auth.user.displayName,
        body,
        ...(data === undefined ? {} : { data }),
      },
    });
  }

  items(
    tenant: TenantContext,
    auth: AuthContext,
    workspaceId: string,
    q: z.output<typeof opsItemListQuerySchema>,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await this.workspaceFor(tx, tenant, workspaceId, 'view');
      const rows = await tx.opsItem.findMany({
        where: {
          workspaceId,
          ...(q.stageId ? { stageId: q.stageId } : {}),
          ...(q.assigneeId ? { assigneeId: q.assigneeId } : {}),
          ...(q.open === undefined ? {} : { stage: { kind: q.open ? 'OPEN' : { not: 'OPEN' } } }),
          ...(q.q ? { title: { contains: q.q, mode: 'insensitive' } } : {}),
        },
        include: itemInclude,
        orderBy: { number: 'desc' },
        take: q.limit,
      });
      return rows.map((i) => this.itemView(i));
    });
  }

  /** Open items assigned to the signed-in employee, across workspaces. */
  mine(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const me = await this.selfId(tx, tenant);
      if (!me) return [];
      const rows = await tx.opsItem.findMany({
        where: { assigneeId: me, stage: { kind: 'OPEN' }, workspace: { status: 'ACTIVE' } },
        include: itemInclude,
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { number: 'desc' }],
        take: 200,
      });
      return rows.map((i) => this.itemView(i));
    });
  }

  async people(tenant: TenantContext, auth: AuthContext, search: string) {
    return this.run(tenant, auth, async (tx) => {
      const term = search.trim();
      const rows = await tx.employee.findMany({
        where: {
          status: { not: 'EXITED' },
          ...(term
            ? {
                OR: [
                  { firstName: { contains: term, mode: 'insensitive' } },
                  { lastName: { contains: term, mode: 'insensitive' } },
                  { employeeCode: { contains: term, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { firstName: 'asc' },
        take: 20,
        select: { id: true, employeeCode: true, firstName: true, lastName: true, preferredName: true },
      });
      return rows.map((e) => ({ id: e.id, code: e.employeeCode, name: displayName(e) }));
    });
  }

  createItem(
    tenant: TenantContext,
    auth: AuthContext,
    workspaceId: string,
    input: z.output<typeof opsItemSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const { w } = await this.workspaceFor(tx, tenant, workspaceId, 'contribute');
      if (w.status !== 'ACTIVE') throw new AppError('WORKSPACE_ARCHIVED', 'This workspace is archived', 409);
      await this.requireAssignee(tx, input.assigneeId);
      const values = await this.checkValues(tx, workspaceId, input.values, true);
      const first = await tx.opsStage.findFirst({ where: { workspaceId }, orderBy: { position: 'asc' } });
      if (!first) throw new AppError('WORKSPACE_NOT_SET_UP', 'This workspace has no stages yet', 409);
      // Taking the next number locks the workspace row, so numbers are never repeated or skipped.
      const { nextNumber } = await tx.opsWorkspace.update({
        where: { id: workspaceId },
        data: { nextNumber: { increment: 1 } },
        select: { nextNumber: true },
      });
      const item = await tx.opsItem.create({
        data: {
          tenantId: tenant.id,
          workspaceId,
          number: nextNumber - 1,
          title: input.title,
          description: input.description ?? null,
          stageId: first.id,
          priority: input.priority,
          assigneeId: input.assigneeId ?? null,
          dueDate: input.dueDate ? toDate(input.dueDate) : null,
          values,
          createdByUserId: auth.user.id,
        },
        include: itemInclude,
      });
      await this.event(tx, tenant, auth, item.id, 'CREATED', null);
      if (item.assigneeId) {
        await this.event(tx, tenant, auth, item.id, 'ASSIGNED', null, { to: displayName(item.assignee!) });
      }
      await this.record(tx, tenant, auth, 'operations.item.create', 'ops_item', item.id, meta);
      return this.itemView(item);
    });
  }

  /** Loads an item for someone who may see it: a viewer or better in its company, or the assignee or creator. */
  private async itemFor(tx: TenantTransaction, tenant: TenantContext, auth: AuthContext, id: string) {
    const item = await tx.opsItem.findUnique({ where: { id }, include: itemInclude });
    if (!item) throw new NotFoundError('Item');
    const w = await tx.opsWorkspace.findUniqueOrThrow({ where: { id: item.workspaceId } });
    const level = this.level(tenant, w.companyId);
    const me = await this.selfId(tx, tenant);
    const mine = (me !== null && item.assigneeId === me) || item.createdByUserId === auth.user.id;
    if (level === 'none' && !mine) throw new NotFoundError('Item');
    const canWork = level === 'contribute' || level === 'manage' || (me !== null && item.assigneeId === me);
    return { item, level, canWork, workspace: w };
  }

  itemDetail(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, async (tx) => {
      const { item, level, canWork } = await this.itemFor(tx, tenant, auth, id);
      const [events, stages, fields] = await Promise.all([
        tx.opsItemEvent.findMany({ where: { itemId: id }, orderBy: { createdAt: 'asc' } }),
        tx.opsStage.findMany({ where: { workspaceId: item.workspaceId }, orderBy: { position: 'asc' } }),
        tx.opsField.findMany({ where: { workspaceId: item.workspaceId }, orderBy: { position: 'asc' } }),
      ]);
      return {
        ...this.itemView(item),
        canWork,
        canAssign: level === 'contribute' || level === 'manage',
        stages: stages.map((s) => ({ id: s.id, key: s.key, label: s.label, kind: s.kind })),
        fields: fields.map((f) => ({
          key: f.key,
          label: f.label,
          type: f.type,
          required: f.required,
          options: (f.options as string[] | null) ?? [],
        })),
        events: events.map((e) => ({
          id: e.id,
          kind: e.kind,
          actor: e.actorName,
          body: e.body,
          data: e.data,
          at: e.createdAt.toISOString(),
        })),
      };
    });
  }

  updateItem(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateOpsItemSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const { item, level, canWork } = await this.itemFor(tx, tenant, auth, id);
      if (!canWork) throw new ForbiddenError();
      const canAssign = level === 'contribute' || level === 'manage';
      if (input.assigneeId !== undefined && input.assigneeId !== item.assigneeId && !canAssign) {
        throw new ForbiddenError();
      }
      const data: Prisma.OpsItemUncheckedUpdateInput = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.description !== undefined) data.description = input.description;
      if (input.priority !== undefined) data.priority = input.priority;
      if (input.dueDate !== undefined) data.dueDate = input.dueDate ? toDate(input.dueDate) : null;
      if (input.values !== undefined) {
        const merged = { ...(item.values as Values), ...input.values };
        data.values = await this.checkValues(tx, item.workspaceId, merged, true);
      }
      const assignChanged = input.assigneeId !== undefined && input.assigneeId !== item.assigneeId;
      if (assignChanged) {
        await this.requireAssignee(tx, input.assigneeId);
        data.assigneeId = input.assigneeId ?? null;
      }
      const updated = await tx.opsItem.update({ where: { id }, data, include: itemInclude });
      await this.event(tx, tenant, auth, id, 'EDITED', null, {
        fields: Object.keys(input).filter((k) => k !== 'assigneeId'),
      });
      if (assignChanged) {
        await this.event(tx, tenant, auth, id, 'ASSIGNED', null, {
          to: updated.assignee ? displayName(updated.assignee) : null,
        });
      }
      await this.record(tx, tenant, auth, 'operations.item.update', 'ops_item', id, meta);
      return this.itemView(updated);
    });
  }

  transition(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof opsTransitionSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const { item, canWork } = await this.itemFor(tx, tenant, auth, id);
      if (!canWork) throw new ForbiddenError();
      const to = await tx.opsStage.findUnique({ where: { id: input.stageId } });
      if (!to || to.workspaceId !== item.workspaceId)
        throw invalid('stageId', 'Choose one of this workspace’s stages');
      if (to.id === item.stageId) throw invalid('stageId', 'It is already there');
      const updated = await tx.opsItem.update({
        where: { id },
        data: { stageId: to.id, completedAt: to.kind === 'OPEN' ? null : new Date() },
        include: itemInclude,
      });
      await this.event(tx, tenant, auth, id, 'STAGE', input.comment ?? null, {
        from: item.stage.label,
        to: to.label,
      });
      await this.record(tx, tenant, auth, 'operations.item.stage', 'ops_item', id, meta, { to: to.key });
      return this.itemView(updated);
    });
  }

  comment(tenant: TenantContext, auth: AuthContext, id: string, input: z.output<typeof opsCommentSchema>) {
    return this.run(tenant, auth, async (tx) => {
      const { canWork, level } = await this.itemFor(tx, tenant, auth, id);
      if (!canWork && level === 'none') throw new ForbiddenError();
      const e = await this.event(tx, tenant, auth, id, 'COMMENT', input.body);
      return { id: e.id };
    });
  }
}
