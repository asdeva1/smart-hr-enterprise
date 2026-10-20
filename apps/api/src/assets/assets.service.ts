import { Injectable } from '@nestjs/common';
import { isUniqueViolation, type Prisma, type TenantTransaction } from '@smart-hr/database';
import { AppError, ForbiddenError, NotFoundError, type ScopeRef } from '@smart-hr/shared';
import type {
  assetListQuerySchema,
  assetSchema,
  assignAssetSchema,
  retireAssetSchema,
  returnAssetSchema,
  updateAssetSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { AttendanceService, toDate } from '../attendance/attendance.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { displayName } from '../employees/employees.service.js';
import { depreciation } from './depreciation.js';

const num = (d: Prisma.Decimal | number) => Number(d);
const iso = (d: Date) => d.toISOString().slice(0, 10);

const companyScopes = (tenantId: string, companyId: string): ScopeRef[] => [
  { type: 'TENANT', id: tenantId },
  { type: 'COMPANY', id: companyId },
];

type AssetRow = Prisma.AssetGetPayload<{ include: { vendor: { select: { id: true; name: true } } } }>;

function invalid(path: string, message: string) {
  return new AppError('VALIDATION_FAILED', message, 400, [{ path, message }]);
}

/**
 * The asset register: what the company owns, who has it, and what it is worth after depreciation. An asset is
 * with at most one person at a time; their history is kept. Assets are retired, never deleted.
 */
@Injectable()
export class AssetsService {
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
    id: string,
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
        targetType: 'asset',
        targetId: id,
        metadata,
      },
      meta,
    );
  }

  private requireManage(tenant: TenantContext, companyId: string) {
    if (!tenant.permissions.allows('assets.manage', companyScopes(tenant.id, companyId))) {
      throw new ForbiddenError();
    }
  }

  private canView(tenant: TenantContext, companyId: string) {
    const scopes = companyScopes(tenant.id, companyId);
    return (
      tenant.permissions.allows('assets.view', scopes) || tenant.permissions.allows('assets.manage', scopes)
    );
  }

  private view(a: AssetRow, today = iso(new Date())) {
    const d = depreciation({
      purchaseDate: iso(a.purchaseDate),
      cost: num(a.purchaseCost),
      salvage: num(a.salvageValue),
      lifeMonths: a.usefulLifeMonths,
      asOf: today,
      retiredOn: a.retiredOn ? iso(a.retiredOn) : null,
    });
    return {
      id: a.id,
      companyId: a.companyId,
      tag: a.tag,
      name: a.name,
      category: a.category,
      serialNumber: a.serialNumber,
      vendor: a.vendor,
      purchaseDate: iso(a.purchaseDate),
      purchaseCost: num(a.purchaseCost),
      salvageValue: num(a.salvageValue),
      usefulLifeMonths: a.usefulLifeMonths,
      currency: a.currency,
      status: a.status,
      notes: a.notes,
      retiredOn: a.retiredOn ? iso(a.retiredOn) : null,
      retireReason: a.retireReason,
      depreciation: d,
    };
  }

  private async load(tx: TenantTransaction, id: string): Promise<AssetRow> {
    const a = await tx.asset.findUnique({
      where: { id },
      include: { vendor: { select: { id: true, name: true } } },
    });
    if (!a) throw new NotFoundError('Asset');
    return a;
  }

  async list(tenant: TenantContext, auth: AuthContext, q: z.output<typeof assetListQuerySchema>) {
    return this.run(tenant, auth, async (tx) => {
      const where: Prisma.AssetWhereInput = {};
      if (q.companyId) where.companyId = q.companyId;
      if (q.status) where.status = q.status;
      if (q.q) {
        where.OR = [
          { tag: { contains: q.q, mode: 'insensitive' } },
          { name: { contains: q.q, mode: 'insensitive' } },
          { serialNumber: { contains: q.q, mode: 'insensitive' } },
        ];
      }
      const rows = await tx.asset.findMany({
        where,
        orderBy: { tag: 'asc' },
        take: 2000,
        include: { vendor: { select: { id: true, name: true } } },
      });
      const open = await tx.assetAssignment.findMany({
        where: { returnedOn: null, assetId: { in: rows.map((r) => r.id) } },
        include: {
          employee: {
            select: { id: true, employeeCode: true, firstName: true, lastName: true, preferredName: true },
          },
        },
      });
      const holder = new Map(
        open.map((o) => [o.assetId, { id: o.employee.id, name: displayName(o.employee) }]),
      );
      return rows
        .filter((a) => this.canView(tenant, a.companyId))
        .map((a) => ({ ...this.view(a), holder: holder.get(a.id) ?? null }));
    });
  }

  /** Current employees a manager can give an asset to, found by name or code. Only the fields needed to choose. */
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

  /** The assets the signed-in employee currently holds. */
  async mine(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const me = await this.attendance.self(tx, tenant);
      if (!me) return [];
      const open = await tx.assetAssignment.findMany({
        where: { employeeId: me.id, returnedOn: null },
        include: { asset: { include: { vendor: { select: { id: true, name: true } } } } },
        orderBy: { assignedOn: 'desc' },
      });
      return open.map((o) => ({
        assignmentId: o.id,
        assignedOn: iso(o.assignedOn),
        conditionOut: o.conditionOut,
        asset: { id: o.asset.id, tag: o.asset.tag, name: o.asset.name, category: o.asset.category },
      }));
    });
  }

  async get(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, async (tx) => {
      const a = await this.load(tx, id);
      if (!this.canView(tenant, a.companyId)) throw new NotFoundError('Asset');
      const history = await tx.assetAssignment.findMany({
        where: { assetId: id },
        orderBy: { assignedOn: 'desc' },
        include: {
          employee: {
            select: { id: true, employeeCode: true, firstName: true, lastName: true, preferredName: true },
          },
        },
      });
      return {
        ...this.view(a),
        canManage: tenant.permissions.allows('assets.manage', companyScopes(tenant.id, a.companyId)),
        history: history.map((h) => ({
          id: h.id,
          employee: { id: h.employee.id, code: h.employee.employeeCode, name: displayName(h.employee) },
          assignedOn: iso(h.assignedOn),
          returnedOn: h.returnedOn ? iso(h.returnedOn) : null,
          conditionOut: h.conditionOut,
          conditionIn: h.conditionIn,
        })),
      };
    });
  }

  async create(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof assetSchema>,
    meta: RequestMeta,
  ) {
    this.requireManage(tenant, input.companyId);
    return this.run(tenant, auth, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: input.companyId },
        select: { baseCurrency: true },
      });
      if (!company) throw invalid('companyId', 'Choose a company');
      if (input.vendorId) {
        const vendor = await tx.vendor.findUnique({ where: { id: input.vendorId } });
        if (!vendor) throw invalid('vendorId', 'Choose a vendor');
      }
      try {
        const a = await tx.asset.create({
          data: {
            tenantId: tenant.id,
            companyId: input.companyId,
            tag: input.tag,
            name: input.name,
            category: input.category,
            serialNumber: input.serialNumber ?? null,
            vendorId: input.vendorId ?? null,
            purchaseDate: toDate(input.purchaseDate),
            purchaseCost: input.purchaseCost,
            salvageValue: input.salvageValue,
            usefulLifeMonths: input.usefulLifeMonths,
            currency: company.baseCurrency,
            notes: input.notes ?? null,
            createdByUserId: auth.user.id,
          },
        });
        await this.record(tx, tenant, auth, 'assets.create', a.id, meta, { tag: a.tag });
        return this.view(await this.load(tx, a.id));
      } catch (error) {
        if (isUniqueViolation(error)) throw invalid('tag', 'That asset tag is already used');
        throw error;
      }
    });
  }

  async update(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateAssetSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const a = await this.load(tx, id);
      this.requireManage(tenant, a.companyId);
      if (a.status === 'RETIRED')
        throw new AppError('ASSET_RETIRED', 'A retired asset can’t be changed', 409);
      const data: Prisma.AssetUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.category !== undefined) data.category = input.category;
      if (input.serialNumber !== undefined) data.serialNumber = input.serialNumber;
      if (input.notes !== undefined) data.notes = input.notes;
      if (input.status !== undefined) {
        if (a.status === 'ASSIGNED') {
          throw new AppError('ASSET_ASSIGNED', 'Take the asset back before changing its status', 409);
        }
        data.status = input.status;
      }
      await tx.asset.update({ where: { id }, data });
      await this.record(tx, tenant, auth, 'assets.update', id, meta);
      return this.view(await this.load(tx, id));
    });
  }

  async assign(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof assignAssetSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM asset WHERE id = ${id}::uuid FOR UPDATE`;
      const a = await this.load(tx, id);
      this.requireManage(tenant, a.companyId);
      if (a.status !== 'IN_STOCK') {
        throw new AppError('ASSET_NOT_AVAILABLE', 'Only an asset that is in stock can be given out', 409);
      }
      const e = await tx.employee.findUnique({
        where: { id: input.employeeId },
        select: { id: true, status: true },
      });
      if (!e || e.status === 'EXITED') throw invalid('employeeId', 'Choose a current employee');
      const on = input.assignedOn ?? iso(new Date());
      if (on < iso(a.purchaseDate)) throw invalid('assignedOn', 'It can’t be given out before it was bought');
      await tx.assetAssignment.create({
        data: {
          tenantId: tenant.id,
          assetId: id,
          employeeId: e.id,
          assignedOn: toDate(on),
          conditionOut: input.condition ?? null,
          assignedByUserId: auth.user.id,
        },
      });
      await tx.asset.update({ where: { id }, data: { status: 'ASSIGNED' } });
      await this.record(tx, tenant, auth, 'assets.assign', id, meta, { employeeId: e.id });
      return this.view(await this.load(tx, id));
    });
  }

  async giveBack(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof returnAssetSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM asset WHERE id = ${id}::uuid FOR UPDATE`;
      const a = await this.load(tx, id);
      this.requireManage(tenant, a.companyId);
      const open = await tx.assetAssignment.findFirst({ where: { assetId: id, returnedOn: null } });
      if (a.status !== 'ASSIGNED' || !open) {
        throw new AppError('ASSET_NOT_ASSIGNED', 'This asset isn’t with anyone', 409);
      }
      const on = input.returnedOn ?? iso(new Date());
      if (on < iso(open.assignedOn))
        throw invalid('returnedOn', 'It can’t come back before it was given out');
      await tx.assetAssignment.update({
        where: { id: open.id },
        data: {
          returnedOn: toDate(on),
          conditionIn: input.condition ?? null,
          returnedByUserId: auth.user.id,
        },
      });
      await tx.asset.update({
        where: { id },
        data: { status: input.needsRepair ? 'UNDER_REPAIR' : 'IN_STOCK' },
      });
      await this.record(tx, tenant, auth, 'assets.return', id, meta, { employeeId: open.employeeId });
      return this.view(await this.load(tx, id));
    });
  }

  async retire(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof retireAssetSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM asset WHERE id = ${id}::uuid FOR UPDATE`;
      const a = await this.load(tx, id);
      this.requireManage(tenant, a.companyId);
      if (a.status === 'RETIRED') throw new AppError('ASSET_RETIRED', 'This asset is already retired', 409);
      if (a.status === 'ASSIGNED') {
        throw new AppError('ASSET_ASSIGNED', 'Take the asset back before retiring it', 409);
      }
      const on = input.retiredOn ?? iso(new Date());
      if (on < iso(a.purchaseDate)) throw invalid('retiredOn', 'It can’t be retired before it was bought');
      await tx.asset.update({
        where: { id },
        data: { status: 'RETIRED', retiredOn: toDate(on), retireReason: input.reason },
      });
      await this.record(tx, tenant, auth, 'assets.retire', id, meta);
      return this.view(await this.load(tx, id));
    });
  }
}
