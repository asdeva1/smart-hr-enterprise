import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { isUniqueViolation, type Prisma, type TenantTransaction } from '@smart-hr/database';
import { AppError, ForbiddenError, NotFoundError, type ScopeRef } from '@smart-hr/shared';
import type {
  inventoryItemSchema,
  movementQuerySchema,
  stockAdjustmentSchema,
  stockIssueSchema,
  stockQuerySchema,
  stockReceiptSchema,
  stockTransferSchema,
  updateInventoryItemSchema,
  updateWarehouseSchema,
  warehouseSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { AttendanceService, toDate } from '../attendance/attendance.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';

const num = (d: Prisma.Decimal | number) => Number(d);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const milli = (q: number) => Math.round(q * 1000);

const companyScopes = (tenantId: string, companyId: string): ScopeRef[] => [
  { type: 'TENANT', id: tenantId },
  { type: 'COMPANY', id: companyId },
];

function invalid(path: string, message: string) {
  return new AppError('VALIDATION_FAILED', message, 400, [{ path, message }]);
}

/** The database refuses a movement that would take stock below zero; say so in plain words. */
function stockError(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('not enough stock')) {
    throw new AppError('INSUFFICIENT_STOCK', 'There isn’t enough stock for that', 409);
  }
  throw error;
}

type ItemRow = Prisma.InventoryItemGetPayload<object>;

/**
 * Inventory: items, warehouses and a stock ledger. Every change to stock is a row that is never edited or
 * removed; stock on hand is the sum of them and the database refuses to let it go below zero.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly audit: AuditService,
  ) {}

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

  private canManage(tenant: TenantContext, companyId: string) {
    return tenant.permissions.allows('inventory.manage', companyScopes(tenant.id, companyId));
  }

  private canView(tenant: TenantContext, companyId: string) {
    return (
      this.canManage(tenant, companyId) ||
      tenant.permissions.allows('inventory.view', companyScopes(tenant.id, companyId))
    );
  }

  /** Items are shared by every company, so changing them takes the permission across the whole organisation. */
  private requireOrganisationWide(tenant: TenantContext) {
    if (!tenant.permissions.allowsTenantWide('inventory.manage')) throw new ForbiddenError();
  }

  // ---- Warehouses ----------------------------------------------------------------------------------

  private warehouseView(w: {
    id: string;
    companyId: string;
    code: string;
    name: string;
    address: string | null;
    status: string;
  }) {
    return {
      id: w.id,
      companyId: w.companyId,
      code: w.code,
      name: w.name,
      address: w.address,
      status: w.status,
    };
  }

  warehouses(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const rows = await tx.warehouse.findMany({ orderBy: { name: 'asc' } });
      return rows.filter((w) => this.canView(tenant, w.companyId)).map((w) => this.warehouseView(w));
    });
  }

  createWarehouse(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof warehouseSchema>,
    meta: RequestMeta,
  ) {
    if (!this.canManage(tenant, input.companyId)) throw new ForbiddenError();
    return this.run(tenant, auth, async (tx) => {
      const company = await tx.company.findUnique({ where: { id: input.companyId }, select: { id: true } });
      if (!company) throw invalid('companyId', 'Choose a company');
      try {
        const w = await tx.warehouse.create({
          data: {
            tenantId: tenant.id,
            companyId: input.companyId,
            code: input.code.toUpperCase(),
            name: input.name,
            address: input.address ?? null,
          },
        });
        await this.record(tx, tenant, auth, 'inventory.warehouse.create', 'warehouse', w.id, meta);
        return this.warehouseView(w);
      } catch (error) {
        if (isUniqueViolation(error)) throw invalid('code', 'That warehouse code is already used');
        throw error;
      }
    });
  }

  updateWarehouse(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateWarehouseSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const existing = await tx.warehouse.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError('Warehouse');
      if (!this.canManage(tenant, existing.companyId)) throw new ForbiddenError();
      const data: Prisma.WarehouseUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.address !== undefined) data.address = input.address;
      if (input.status !== undefined) data.status = input.status;
      const w = await tx.warehouse.update({ where: { id }, data });
      await this.record(tx, tenant, auth, 'inventory.warehouse.update', 'warehouse', id, meta);
      return this.warehouseView(w);
    });
  }

  // ---- Items ---------------------------------------------------------------------------------------

  private itemView(i: ItemRow) {
    return {
      id: i.id,
      sku: i.sku,
      name: i.name,
      unit: i.unit,
      category: i.category,
      reorderLevel: i.reorderLevel === null ? null : num(i.reorderLevel),
      standardCost: num(i.standardCost),
      notes: i.notes,
      status: i.status,
    };
  }

  items(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const rows = await tx.inventoryItem.findMany({ orderBy: { sku: 'asc' }, take: 5000 });
      return rows.map((i) => this.itemView(i));
    });
  }

  createItem(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof inventoryItemSchema>,
    meta: RequestMeta,
  ) {
    this.requireOrganisationWide(tenant);
    return this.run(tenant, auth, async (tx) => {
      try {
        const i = await tx.inventoryItem.create({
          data: {
            tenantId: tenant.id,
            sku: input.sku,
            name: input.name,
            unit: input.unit,
            category: input.category ?? null,
            reorderLevel: input.reorderLevel ?? null,
            standardCost: input.standardCost,
            notes: input.notes ?? null,
          },
        });
        await this.record(tx, tenant, auth, 'inventory.item.create', 'inventory_item', i.id, meta);
        return this.itemView(i);
      } catch (error) {
        if (isUniqueViolation(error)) throw invalid('sku', 'That SKU is already used');
        throw error;
      }
    });
  }

  updateItem(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateInventoryItemSchema>,
    meta: RequestMeta,
  ) {
    this.requireOrganisationWide(tenant);
    return this.run(tenant, auth, async (tx) => {
      const existing = await tx.inventoryItem.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError('Item');
      const data: Prisma.InventoryItemUpdateInput = {};
      for (const key of [
        'name',
        'unit',
        'category',
        'reorderLevel',
        'standardCost',
        'notes',
        'status',
      ] as const) {
        if (input[key] !== undefined) (data as Record<string, unknown>)[key] = input[key];
      }
      const i = await tx.inventoryItem.update({ where: { id }, data });
      await this.record(tx, tenant, auth, 'inventory.item.update', 'inventory_item', id, meta);
      return this.itemView(i);
    });
  }

  async item(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, async (tx) => {
      const i = await tx.inventoryItem.findUnique({ where: { id } });
      if (!i) throw new NotFoundError('Item');
      const stock = await this.stockRows(tx, tenant, { itemId: id });
      const movements = await this.movementRows(tx, tenant, { itemId: id, limit: 50 });
      return { ...this.itemView(i), stock, movements };
    });
  }

  // ---- Stock and the ledger ------------------------------------------------------------------------

  private async visibleWarehouses(tx: TenantTransaction, tenant: TenantContext) {
    const all = await tx.warehouse.findMany();
    return new Map(all.filter((w) => this.canView(tenant, w.companyId)).map((w) => [w.id, w]));
  }

  private async stockRows(
    tx: TenantTransaction,
    tenant: TenantContext,
    q: { warehouseId?: string | undefined; itemId?: string | undefined; lowOnly?: boolean | undefined },
  ) {
    const warehouses = await this.visibleWarehouses(tx, tenant);
    const where: Prisma.StockMovementWhereInput = { warehouseId: { in: [...warehouses.keys()] } };
    if (q.warehouseId) where.warehouseId = q.warehouseId;
    if (q.itemId) where.itemId = q.itemId;
    const sums = await tx.stockMovement.groupBy({
      by: ['itemId', 'warehouseId'],
      where,
      _sum: { quantity: true },
    });
    const items = new Map(
      (
        await tx.inventoryItem.findMany({ where: { id: { in: [...new Set(sums.map((s) => s.itemId))] } } })
      ).map((i) => [i.id, i]),
    );
    const rows = sums
      .map((s) => {
        const item = items.get(s.itemId)!;
        const warehouse = warehouses.get(s.warehouseId);
        if (!warehouse) return null;
        const onHand = num(s._sum.quantity ?? 0);
        const low = item.reorderLevel !== null && milli(onHand) <= milli(num(item.reorderLevel));
        return {
          item: { id: item.id, sku: item.sku, name: item.name, unit: item.unit },
          warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name },
          onHand,
          reorderLevel: item.reorderLevel === null ? null : num(item.reorderLevel),
          low,
          value: Math.round(onHand * num(item.standardCost) * 100) / 100,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null && (r.onHand !== 0 || !!q.itemId));
    const out = q.lowOnly ? rows.filter((r) => r.low) : rows;
    return out.sort(
      (a, b) => a.item.sku.localeCompare(b.item.sku) || a.warehouse.code.localeCompare(b.warehouse.code),
    );
  }

  stock(tenant: TenantContext, auth: AuthContext, q: z.output<typeof stockQuerySchema>) {
    return this.run(tenant, auth, (tx) => this.stockRows(tx, tenant, q));
  }

  private async movementRows(
    tx: TenantTransaction,
    tenant: TenantContext,
    q: { warehouseId?: string | undefined; itemId?: string | undefined; limit: number },
  ) {
    const warehouses = await this.visibleWarehouses(tx, tenant);
    const where: Prisma.StockMovementWhereInput = { warehouseId: { in: [...warehouses.keys()] } };
    if (q.warehouseId) where.warehouseId = q.warehouseId;
    if (q.itemId) where.itemId = q.itemId;
    const rows = await tx.stockMovement.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit,
      include: { item: { select: { sku: true, name: true } } },
    });
    return rows.map((m) => ({
      id: m.id,
      kind: m.kind,
      item: { id: m.itemId, sku: m.item.sku, name: m.item.name },
      warehouse: { id: m.warehouseId, code: warehouses.get(m.warehouseId)?.code ?? '' },
      quantity: num(m.quantity),
      unitCost: m.unitCost === null ? null : num(m.unitCost),
      occurredOn: iso(m.occurredOn),
      reference: m.reference,
      note: m.note,
      transferId: m.transferId,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  movements(tenant: TenantContext, auth: AuthContext, q: z.output<typeof movementQuerySchema>) {
    return this.run(tenant, auth, (tx) => this.movementRows(tx, tenant, q));
  }

  /** The warehouse and item for a movement, checking the caller may change stock there. */
  private async target(tx: TenantTransaction, tenant: TenantContext, itemId: string, warehouseId: string) {
    const [item, warehouse] = await Promise.all([
      tx.inventoryItem.findUnique({ where: { id: itemId } }),
      tx.warehouse.findUnique({ where: { id: warehouseId } }),
    ]);
    if (!item || item.status !== 'ACTIVE') throw invalid('itemId', 'Choose an active item');
    if (!warehouse) throw invalid('warehouseId', 'Choose a warehouse');
    if (!this.canManage(tenant, warehouse.companyId)) throw new ForbiddenError();
    if (warehouse.status !== 'ACTIVE') throw invalid('warehouseId', 'That warehouse is archived');
    return { item, warehouse };
  }

  private async onHand(tx: TenantTransaction, itemId: string, warehouseId: string) {
    const sum = await tx.stockMovement.aggregate({
      where: { itemId, warehouseId },
      _sum: { quantity: true },
    });
    return num(sum._sum.quantity ?? 0);
  }

  private dateOf(input: { occurredOn?: string | undefined }) {
    const on = input.occurredOn ?? iso(new Date());
    if (on > iso(new Date(Date.now() + 86_400_000)))
      throw invalid('occurredOn', 'The date can’t be in the future');
    return toDate(on);
  }

  private async post(
    tx: TenantTransaction,
    tenant: TenantContext,
    auth: AuthContext,
    meta: RequestMeta,
    rows: Prisma.StockMovementCreateManyInput[],
    action: string,
  ) {
    try {
      await tx.stockMovement.createMany({ data: rows });
    } catch (error) {
      stockError(error);
    }
    await this.record(tx, tenant, auth, action, 'stock_movement', rows[0]!.id!, meta, {
      quantity: num(rows[0]!.quantity as number),
    });
  }

  receive(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof stockReceiptSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const { item, warehouse } = await this.target(tx, tenant, input.itemId, input.warehouseId);
      const id = randomUUID();
      await this.post(
        tx,
        tenant,
        auth,
        meta,
        [
          {
            id,
            tenantId: tenant.id,
            itemId: item.id,
            warehouseId: warehouse.id,
            kind: 'RECEIPT',
            quantity: input.quantity,
            unitCost: input.unitCost ?? null,
            occurredOn: this.dateOf(input),
            reference: input.reference ?? null,
            note: input.note ?? null,
            createdByUserId: auth.user.id,
          },
        ],
        'inventory.receive',
      );
      return { onHand: await this.onHand(tx, item.id, warehouse.id) };
    });
  }

  issue(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof stockIssueSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const { item, warehouse } = await this.target(tx, tenant, input.itemId, input.warehouseId);
      const have = await this.onHand(tx, item.id, warehouse.id);
      if (milli(input.quantity) > milli(have)) {
        throw new AppError('INSUFFICIENT_STOCK', `Only ${have} ${item.unit} on hand`, 409, [
          { path: 'quantity', message: `Only ${have} on hand` },
        ]);
      }
      await this.post(
        tx,
        tenant,
        auth,
        meta,
        [
          {
            id: randomUUID(),
            tenantId: tenant.id,
            itemId: item.id,
            warehouseId: warehouse.id,
            kind: 'ISSUE',
            quantity: -input.quantity,
            occurredOn: this.dateOf(input),
            reference: input.reference ?? null,
            note: input.note ?? null,
            createdByUserId: auth.user.id,
          },
        ],
        'inventory.issue',
      );
      return { onHand: await this.onHand(tx, item.id, warehouse.id) };
    });
  }

  adjust(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof stockAdjustmentSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const { item, warehouse } = await this.target(tx, tenant, input.itemId, input.warehouseId);
      const have = await this.onHand(tx, item.id, warehouse.id);
      if (milli(have) + milli(input.quantity) < 0) {
        throw new AppError('INSUFFICIENT_STOCK', `Only ${have} ${item.unit} on hand`, 409, [
          { path: 'quantity', message: `Only ${have} on hand` },
        ]);
      }
      await this.post(
        tx,
        tenant,
        auth,
        meta,
        [
          {
            id: randomUUID(),
            tenantId: tenant.id,
            itemId: item.id,
            warehouseId: warehouse.id,
            kind: 'ADJUSTMENT',
            quantity: input.quantity,
            occurredOn: this.dateOf(input),
            reference: input.reference ?? null,
            note: input.note,
            createdByUserId: auth.user.id,
          },
        ],
        'inventory.adjust',
      );
      return { onHand: await this.onHand(tx, item.id, warehouse.id) };
    });
  }

  transfer(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof stockTransferSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const from = await this.target(tx, tenant, input.itemId, input.fromWarehouseId);
      const to = await this.target(tx, tenant, input.itemId, input.toWarehouseId);
      const have = await this.onHand(tx, from.item.id, from.warehouse.id);
      if (milli(input.quantity) > milli(have)) {
        throw new AppError('INSUFFICIENT_STOCK', `Only ${have} ${from.item.unit} on hand there`, 409, [
          { path: 'quantity', message: `Only ${have} on hand` },
        ]);
      }
      const transferId = randomUUID();
      const common = {
        tenantId: tenant.id,
        itemId: from.item.id,
        occurredOn: this.dateOf(input),
        reference: input.reference ?? null,
        note: input.note ?? null,
        transferId,
        createdByUserId: auth.user.id,
      };
      await this.post(
        tx,
        tenant,
        auth,
        meta,
        [
          {
            ...common,
            id: randomUUID(),
            warehouseId: from.warehouse.id,
            kind: 'TRANSFER_OUT',
            quantity: -input.quantity,
          },
          {
            ...common,
            id: randomUUID(),
            warehouseId: to.warehouse.id,
            kind: 'TRANSFER_IN',
            quantity: input.quantity,
          },
        ],
        'inventory.transfer',
      );
      return {
        from: await this.onHand(tx, from.item.id, from.warehouse.id),
        to: await this.onHand(tx, to.item.id, to.warehouse.id),
        transferId,
      };
    });
  }
}
