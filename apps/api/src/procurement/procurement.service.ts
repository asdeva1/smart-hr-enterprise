import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type ApprovalRequest, type Prisma, type TenantTransaction } from '@smart-hr/database';
import { AppError, ForbiddenError, NotFoundError, type ScopeRef } from '@smart-hr/shared';
import type {
  purchaseOrderListQuerySchema,
  purchaseOrderSchema,
  purchaseRequestListQuerySchema,
  purchaseRequestSchema,
  receiveGoodsSchema,
  updatePurchaseOrderSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { ApprovalSubjectRegistry } from '../approvals/approval-subjects.js';
import { ApprovalEngine } from '../approvals/approval.engine.js';
import { AuditService } from '../audit/audit.service.js';
import { AttendanceService, scopeOfEmployee, toDate } from '../attendance/attendance.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { displayName } from '../employees/employees.service.js';
import { OrgIndex } from '../employees/org-index.js';

export const REQUEST_SUBJECT = 'purchase_requisition';
export const ORDER_SUBJECT = 'purchase_order';

const num = (d: Prisma.Decimal | number) => Number(d);
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Amounts are worked out in whole paise and quantities in thousandths, so nothing drifts. */
const milli = (q: number) => Math.round(q * 1000);
const paise = (n: number) => Math.round(n * 100);

function invalid(path: string, message: string) {
  return new AppError('VALIDATION_FAILED', message, 400, [{ path, message }]);
}

/** One order line's money, in paise: price × quantity, and the tax on it. */
export function lineAmounts(quantity: number, unitPrice: number, taxRate: number) {
  const net = Math.round((milli(quantity) * paise(unitPrice)) / 1000);
  const tax = Math.round((net * Math.round(taxRate * 100)) / 10_000);
  return { net, tax };
}

const companyScopes = (tenantId: string, companyId: string): ScopeRef[] => [
  { type: 'TENANT', id: tenantId },
  { type: 'COMPANY', id: companyId },
];

/**
 * Procurement: purchase requests from employees, purchase orders to vendors, and goods received against
 * them. Requests and orders both go through the approval engine; lines can be changed only while a draft.
 */
@Injectable()
export class ProcurementService implements OnModuleInit {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly engine: ApprovalEngine,
    private readonly subjects: ApprovalSubjectRegistry,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    const requestTo =
      (status: 'REJECTED' | 'DRAFT' | 'CANCELLED' | 'PENDING_APPROVAL' | 'APPROVED') =>
      async (tx: TenantTransaction, request: ApprovalRequest, comment?: string | null) => {
        await tx.purchaseRequest.update({
          where: { id: request.subjectId },
          data: {
            status,
            decisionNote: comment ?? null,
            decidedAt: status === 'PENDING_APPROVAL' || status === 'DRAFT' ? null : new Date(),
          },
        });
      };
    this.subjects.register(REQUEST_SUBJECT, {
      onApproved: requestTo('APPROVED'),
      onRejected: requestTo('REJECTED'),
      onReturned: requestTo('DRAFT'),
      onCancelled: requestTo('CANCELLED'),
      onResubmitted: requestTo('PENDING_APPROVAL'),
      link: (request) => `/procurement/requests/${request.subjectId}`,
    });

    const orderTo =
      (status: 'REJECTED' | 'DRAFT' | 'CANCELLED' | 'PENDING_APPROVAL' | 'APPROVED') =>
      async (tx: TenantTransaction, request: ApprovalRequest, comment?: string | null) => {
        const order = await tx.purchaseOrder.update({
          where: { id: request.subjectId },
          data: {
            status,
            decisionNote: comment ?? null,
            decidedAt: status === 'PENDING_APPROVAL' || status === 'DRAFT' ? null : new Date(),
          },
        });
        if (status === 'REJECTED' || status === 'CANCELLED') await this.releaseRequest(tx, order.requestId);
      };
    this.subjects.register(ORDER_SUBJECT, {
      onApproved: orderTo('APPROVED'),
      onRejected: orderTo('REJECTED'),
      onReturned: orderTo('DRAFT'),
      onCancelled: orderTo('CANCELLED'),
      onResubmitted: orderTo('PENDING_APPROVAL'),
      link: (request) => `/procurement/orders/${request.subjectId}`,
    });
  }

  run<T>(tenant: TenantContext, auth: AuthContext, work: (tx: TenantTransaction) => Promise<T>) {
    return this.attendance.run(tenant, auth, work);
  }

  private actor(tenant: TenantContext, auth: AuthContext) {
    return {
      tenantId: tenant.id,
      membershipId: tenant.membershipId,
      userId: auth.user.id,
      displayName: auth.user.displayName,
    };
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

  /** Next number like PO-000012, one sequence per organisation and kind. */
  private async nextNumber(tx: TenantTransaction, tenantId: string, kind: 'PR' | 'PO' | 'GRN') {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`procurement-number:${tenantId}:${kind}`}))`;
    const startsWith = `${kind}-`;
    const where = { number: { startsWith } };
    const orderBy = { number: 'desc' } as const;
    const select = { number: true } as const;
    const last =
      kind === 'PR'
        ? await tx.purchaseRequest.findFirst({ where, orderBy, select })
        : kind === 'PO'
          ? await tx.purchaseOrder.findFirst({ where, orderBy, select })
          : await tx.goodsReceipt.findFirst({ where, orderBy, select });
    const next = (last?.number ? Number(last.number.slice(startsWith.length)) : 0) + 1;
    return `${startsWith}${String(next).padStart(6, '0')}`;
  }

  /** An order that came to nothing frees its request to be ordered again. */
  private async releaseRequest(tx: TenantTransaction, requestId: string | null) {
    if (!requestId) return;
    const live = await tx.purchaseOrder.count({
      where: { requestId, status: { notIn: ['REJECTED', 'CANCELLED'] } },
    });
    if (live === 0) {
      await tx.purchaseRequest.updateMany({
        where: { id: requestId, status: 'ORDERED' },
        data: { status: 'APPROVED' },
      });
    }
  }

  // ---- Purchase requests ---------------------------------------------------------------------------

  private async requestView(tx: TenantTransaction, id: string, membershipId: string) {
    const r = await tx.purchaseRequest.findUnique({
      where: { id },
      include: {
        lines: { orderBy: { position: 'asc' } },
        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            preferredName: true,
            membershipId: true,
          },
        },
        orders: { select: { id: true, number: true, status: true } },
      },
    });
    if (!r) throw new NotFoundError('Purchase request');
    const approval = r.approvalRequestId
      ? await tx.approvalRequest.findUnique({
          where: { id: r.approvalRequestId },
          select: { id: true, status: true },
        })
      : null;
    return {
      id: r.id,
      number: r.number,
      title: r.title,
      justification: r.justification,
      status: r.status,
      estimatedTotal: num(r.estimatedTotal),
      currency: r.currency,
      employee: { id: r.employee.id, code: r.employee.employeeCode, name: displayName(r.employee) },
      mine: r.employee.membershipId === membershipId,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
      approvalRequest: approval,
      orders: r.orders,
      lines: r.lines.map((l) => ({
        id: l.id,
        position: l.position,
        description: l.description,
        quantity: num(l.quantity),
        estimatedUnitPrice: num(l.estimatedUnitPrice),
        amount: Math.round(num(l.quantity) * num(l.estimatedUnitPrice) * 100) / 100,
      })),
    };
  }

  private requestLines(lines: z.output<typeof purchaseRequestSchema>['lines']) {
    let total = 0;
    const rows = lines.map((l, i) => {
      total += Math.round((milli(l.quantity) * paise(l.estimatedUnitPrice)) / 1000);
      return {
        position: i + 1,
        description: l.description,
        quantity: l.quantity,
        estimatedUnitPrice: l.estimatedUnitPrice,
      };
    });
    return { rows, total: total / 100 };
  }

  async createRequest(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof purchaseRequestSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const e = await this.attendance.requireSelf(tx, tenant);
      const company = await tx.company.findUniqueOrThrow({
        where: { id: e.companyId },
        select: { baseCurrency: true },
      });
      const { rows, total } = this.requestLines(input.lines);
      const r = await tx.purchaseRequest.create({
        data: {
          tenantId: tenant.id,
          employeeId: e.id,
          title: input.title,
          justification: input.justification ?? null,
          estimatedTotal: total,
          currency: company.baseCurrency,
          createdByUserId: auth.user.id,
        },
      });
      await tx.purchaseRequestLine.createMany({
        data: rows.map((l) => ({ ...l, tenantId: tenant.id, requestId: r.id })),
      });
      await this.record(tx, tenant, auth, 'procurement.request.create', 'purchase_request', r.id, meta);
      return this.requestView(tx, r.id, tenant.membershipId);
    });
  }

  private async ownRequest(tx: TenantTransaction, tenant: TenantContext, auth: AuthContext, id: string) {
    const r = await tx.purchaseRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundError('Purchase request');
    const e = await tx.employee.findUniqueOrThrow({
      where: { id: r.employeeId },
      select: { membershipId: true },
    });
    if (e.membershipId !== tenant.membershipId && r.createdByUserId !== auth.user.id) {
      throw new NotFoundError('Purchase request');
    }
    return r;
  }

  async updateRequest(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof purchaseRequestSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const r = await this.ownRequest(tx, tenant, auth, id);
      if (r.status !== 'DRAFT') throw new AppError('REQUEST_LOCKED', 'Only a draft can be changed', 409);
      const { rows, total } = this.requestLines(input.lines);
      await tx.purchaseRequestLine.deleteMany({ where: { requestId: id } });
      await tx.purchaseRequest.update({
        where: { id },
        data: { title: input.title, justification: input.justification ?? null, estimatedTotal: total },
      });
      await tx.purchaseRequestLine.createMany({
        data: rows.map((l) => ({ ...l, tenantId: tenant.id, requestId: id })),
      });
      await this.record(tx, tenant, auth, 'procurement.request.update', 'purchase_request', id, meta);
      return this.requestView(tx, id, tenant.membershipId);
    });
  }

  async submitRequest(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const r = await this.ownRequest(tx, tenant, auth, id);
      if (r.status !== 'DRAFT')
        throw new AppError('REQUEST_LOCKED', 'This request has already been sent', 409);
      const e = await this.attendance.requireSelf(tx, tenant);
      const actor = this.actor(tenant, auth);
      if (r.approvalRequestId) {
        await tx.purchaseRequest.update({ where: { id }, data: { submittedAt: new Date() } });
        await this.engine.resubmit(tx, actor, r.approvalRequestId, meta);
      } else {
        const number = await this.nextNumber(tx, tenant.id, 'PR');
        await tx.purchaseRequest.update({
          where: { id },
          data: { number, status: 'PENDING_APPROVAL', submittedAt: new Date(), decisionNote: null },
        });
        const approval = await this.engine.submit(
          tx,
          actor,
          {
            subjectType: REQUEST_SUBJECT,
            subjectId: id,
            title: `${number}: ${r.title} — ${displayName(e)}`,
            amount: r.estimatedTotal.toFixed(2),
            currency: r.currency,
            scope: scopeOfEmployee(tenant.id, e),
            subjectEmployeeId: e.id,
          },
          meta,
        );
        await tx.purchaseRequest.update({ where: { id }, data: { approvalRequestId: approval.id } });
      }
      await this.record(tx, tenant, auth, 'procurement.request.submit', 'purchase_request', id, meta);
      return this.requestView(tx, id, tenant.membershipId);
    });
  }

  async cancelRequest(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const r = await this.ownRequest(tx, tenant, auth, id);
      if (r.status === 'DRAFT' && !r.approvalRequestId) {
        await tx.purchaseRequest.update({
          where: { id },
          data: { status: 'CANCELLED', decidedAt: new Date() },
        });
      } else if ((r.status === 'DRAFT' || r.status === 'PENDING_APPROVAL') && r.approvalRequestId) {
        await this.engine.cancel(tx, this.actor(tenant, auth), r.approvalRequestId, meta);
      } else {
        throw new AppError('REQUEST_LOCKED', 'Only an open request can be withdrawn', 409);
      }
      await this.record(tx, tenant, auth, 'procurement.request.cancel', 'purchase_request', id, meta);
      return this.requestView(tx, id, tenant.membershipId);
    });
  }

  async getRequest(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, async (tx) => {
      const r = await tx.purchaseRequest.findUnique({
        where: { id },
        include: { employee: { select: this.employeeScopeSelect } },
      });
      if (!r) throw new NotFoundError('Purchase request');
      const org = await OrgIndex.load(tx, tenant.id);
      let ok =
        r.employee.membershipId === tenant.membershipId ||
        tenant.permissions.allows('procurement.view', org.scopesOf(r.employee));
      if (!ok && r.approvalRequestId) {
        ok =
          (await tx.approvalTask.count({
            where: { requestId: r.approvalRequestId, assignedMembershipId: tenant.membershipId },
          })) > 0;
      }
      if (!ok) throw new NotFoundError('Purchase request');
      return this.requestView(tx, id, tenant.membershipId);
    });
  }

  private readonly employeeScopeSelect = {
    id: true,
    employeeCode: true,
    firstName: true,
    lastName: true,
    preferredName: true,
    companyId: true,
    branchId: true,
    departmentId: true,
    membershipId: true,
  } as const;

  async listRequests(
    tenant: TenantContext,
    auth: AuthContext,
    q: z.output<typeof purchaseRequestListQuerySchema>,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const where: Prisma.PurchaseRequestWhereInput = q.status ? { status: q.status } : {};
      if (q.scope === 'mine') where.employee = { membershipId: tenant.membershipId };
      const rows = await tx.purchaseRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 500,
        include: { employee: { select: this.employeeScopeSelect } },
      });
      return rows
        .filter(
          (r) =>
            q.scope === 'mine' ||
            r.employee.membershipId === tenant.membershipId ||
            tenant.permissions.allows('procurement.view', org.scopesOf(r.employee)),
        )
        .map((r) => ({
          id: r.id,
          number: r.number,
          title: r.title,
          status: r.status,
          estimatedTotal: num(r.estimatedTotal),
          currency: r.currency,
          employee: { id: r.employee.id, code: r.employee.employeeCode, name: displayName(r.employee) },
          createdAt: r.createdAt.toISOString(),
        }));
    });
  }

  // ---- Purchase orders -----------------------------------------------------------------------------

  private async orderView(tx: TenantTransaction, id: string) {
    const o = await tx.purchaseOrder.findUnique({
      where: { id },
      include: {
        lines: { orderBy: { position: 'asc' } },
        vendor: { select: { id: true, code: true, name: true } },
        request: { select: { id: true, number: true, title: true } },
        receipts: {
          orderBy: { createdAt: 'asc' },
          include: { lines: { select: { orderLineId: true, quantity: true } } },
        },
      },
    });
    if (!o) throw new NotFoundError('Purchase order');
    const approval = o.approvalRequestId
      ? await tx.approvalRequest.findUnique({
          where: { id: o.approvalRequestId },
          select: { id: true, status: true },
        })
      : null;
    return {
      id: o.id,
      number: o.number,
      companyId: o.companyId,
      vendor: o.vendor,
      request: o.request,
      status: o.status,
      orderDate: iso(o.orderDate),
      expectedDate: o.expectedDate ? iso(o.expectedDate) : null,
      terms: o.terms,
      subtotal: num(o.subtotal),
      taxTotal: num(o.taxTotal),
      total: num(o.total),
      currency: o.currency,
      decisionNote: o.decisionNote,
      createdAt: o.createdAt.toISOString(),
      approvalRequest: approval,
      lines: o.lines.map((l) => {
        const { net, tax } = lineAmounts(num(l.quantity), num(l.unitPrice), num(l.taxRate));
        return {
          id: l.id,
          position: l.position,
          description: l.description,
          quantity: num(l.quantity),
          unitPrice: num(l.unitPrice),
          taxRate: num(l.taxRate),
          amount: (net + tax) / 100,
          receivedQuantity: num(l.receivedQuantity),
        };
      }),
      receipts: o.receipts.map((g) => ({
        id: g.id,
        number: g.number,
        receivedOn: iso(g.receivedOn),
        note: g.note,
        lines: g.lines.map((l) => ({ orderLineId: l.orderLineId, quantity: num(l.quantity) })),
      })),
    };
  }

  private orderLines(lines: z.output<typeof purchaseOrderSchema>['lines']) {
    let subtotal = 0;
    let taxTotal = 0;
    const rows = lines.map((l, i) => {
      const { net, tax } = lineAmounts(l.quantity, l.unitPrice, l.taxRate);
      subtotal += net;
      taxTotal += tax;
      return {
        position: i + 1,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRate: l.taxRate,
      };
    });
    return { rows, subtotal: subtotal / 100, taxTotal: taxTotal / 100, total: (subtotal + taxTotal) / 100 };
  }

  private requireManage(tenant: TenantContext, companyId: string) {
    if (!tenant.permissions.allows('procurement.manage', companyScopes(tenant.id, companyId))) {
      throw new ForbiddenError();
    }
  }

  /** The caller may see an order if they manage or view procurement for its company, made it, or approve it. */
  private async canSeeOrder(
    tx: TenantTransaction,
    tenant: TenantContext,
    o: { companyId: string; createdByUserId: string; approvalRequestId: string | null },
    userId: string,
  ) {
    const scopes = companyScopes(tenant.id, o.companyId);
    if (tenant.permissions.allows('procurement.view', scopes)) return true;
    if (tenant.permissions.allows('procurement.manage', scopes)) return true;
    if (o.createdByUserId === userId) return true;
    if (o.approvalRequestId) {
      return (
        (await tx.approvalTask.count({
          where: { requestId: o.approvalRequestId, assignedMembershipId: tenant.membershipId },
        })) > 0
      );
    }
    return false;
  }

  async createOrder(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof purchaseOrderSchema>,
    meta: RequestMeta,
  ) {
    this.requireManage(tenant, input.companyId);
    return this.run(tenant, auth, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: input.companyId },
        select: { baseCurrency: true },
      });
      if (!company) throw invalid('companyId', 'Choose a company');
      const vendor = await tx.vendor.findUnique({ where: { id: input.vendorId } });
      if (!vendor || vendor.status !== 'ACTIVE') throw invalid('vendorId', 'Choose an active vendor');
      if (input.requestId) {
        const request = await tx.purchaseRequest.findUnique({ where: { id: input.requestId } });
        if (!request || request.status !== 'APPROVED') {
          throw invalid('requestId', 'Only an approved purchase request can be ordered');
        }
      }
      const { rows, subtotal, taxTotal, total } = this.orderLines(input.lines);
      const o = await tx.purchaseOrder.create({
        data: {
          tenantId: tenant.id,
          companyId: input.companyId,
          vendorId: input.vendorId,
          requestId: input.requestId ?? null,
          orderDate: toDate(input.orderDate),
          expectedDate: input.expectedDate ? toDate(input.expectedDate) : null,
          terms: input.terms ?? null,
          subtotal,
          taxTotal,
          total,
          currency: company.baseCurrency,
          createdByUserId: auth.user.id,
        },
      });
      await tx.purchaseOrderLine.createMany({
        data: rows.map((l) => ({ ...l, tenantId: tenant.id, orderId: o.id })),
      });
      if (input.requestId) {
        await tx.purchaseRequest.update({ where: { id: input.requestId }, data: { status: 'ORDERED' } });
      }
      await this.record(tx, tenant, auth, 'procurement.order.create', 'purchase_order', o.id, meta, {
        total,
      });
      return this.orderView(tx, o.id);
    });
  }

  async updateOrder(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updatePurchaseOrderSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const o = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!o) throw new NotFoundError('Purchase order');
      this.requireManage(tenant, o.companyId);
      if (o.status !== 'DRAFT') throw new AppError('ORDER_LOCKED', 'Only a draft order can be changed', 409);
      const vendor = await tx.vendor.findUnique({ where: { id: input.vendorId } });
      if (!vendor || (vendor.status !== 'ACTIVE' && vendor.id !== o.vendorId)) {
        throw invalid('vendorId', 'Choose an active vendor');
      }
      const { rows, subtotal, taxTotal, total } = this.orderLines(input.lines);
      await tx.purchaseOrderLine.deleteMany({ where: { orderId: id } });
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          vendorId: input.vendorId,
          orderDate: toDate(input.orderDate),
          expectedDate: input.expectedDate ? toDate(input.expectedDate) : null,
          terms: input.terms ?? null,
          subtotal,
          taxTotal,
          total,
        },
      });
      await tx.purchaseOrderLine.createMany({
        data: rows.map((l) => ({ ...l, tenantId: tenant.id, orderId: id })),
      });
      await this.record(tx, tenant, auth, 'procurement.order.update', 'purchase_order', id, meta, { total });
      return this.orderView(tx, id);
    });
  }

  async submitOrder(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const o = await tx.purchaseOrder.findUnique({ where: { id }, include: { vendor: true } });
      if (!o) throw new NotFoundError('Purchase order');
      this.requireManage(tenant, o.companyId);
      if (o.status !== 'DRAFT') throw new AppError('ORDER_LOCKED', 'This order has already been sent', 409);
      if (o.vendor.status !== 'ACTIVE') throw invalid('vendorId', 'The vendor is archived');
      const actor = this.actor(tenant, auth);
      if (o.approvalRequestId) {
        await tx.purchaseOrder.update({ where: { id }, data: { submittedAt: new Date() } });
        await this.engine.resubmit(tx, actor, o.approvalRequestId, meta);
      } else {
        const number = await this.nextNumber(tx, tenant.id, 'PO');
        await tx.purchaseOrder.update({
          where: { id },
          data: { number, status: 'PENDING_APPROVAL', submittedAt: new Date(), decisionNote: null },
        });
        const approval = await this.engine.submit(
          tx,
          actor,
          {
            subjectType: ORDER_SUBJECT,
            subjectId: id,
            title: `${number}: ${o.vendor.name}`,
            amount: o.total.toFixed(2),
            currency: o.currency,
            scope: { type: 'COMPANY', id: o.companyId },
          },
          meta,
        );
        await tx.purchaseOrder.update({ where: { id }, data: { approvalRequestId: approval.id } });
      }
      await this.record(tx, tenant, auth, 'procurement.order.submit', 'purchase_order', id, meta);
      return this.orderView(tx, id);
    });
  }

  async cancelOrder(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const o = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!o) throw new NotFoundError('Purchase order');
      this.requireManage(tenant, o.companyId);
      if (o.status === 'DRAFT' && !o.approvalRequestId) {
        await tx.purchaseOrder.update({
          where: { id },
          data: { status: 'CANCELLED', decidedAt: new Date() },
        });
        await this.releaseRequest(tx, o.requestId);
      } else if ((o.status === 'DRAFT' || o.status === 'PENDING_APPROVAL') && o.approvalRequestId) {
        await this.engine.cancel(tx, this.actor(tenant, auth), o.approvalRequestId, meta);
      } else if (o.status === 'APPROVED') {
        // Approved but nothing has arrived yet: the order can still be called off.
        await tx.purchaseOrder.update({
          where: { id },
          data: { status: 'CANCELLED', decidedAt: new Date() },
        });
        await this.releaseRequest(tx, o.requestId);
      } else {
        throw new AppError('ORDER_LOCKED', 'This order can no longer be cancelled', 409);
      }
      await this.record(tx, tenant, auth, 'procurement.order.cancel', 'purchase_order', id, meta);
      return this.orderView(tx, id);
    });
  }

  async getOrder(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, async (tx) => {
      const o = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!o || !(await this.canSeeOrder(tx, tenant, o, auth.user.id)))
        throw new NotFoundError('Purchase order');
      return this.orderView(tx, id);
    });
  }

  async listOrders(
    tenant: TenantContext,
    auth: AuthContext,
    q: z.output<typeof purchaseOrderListQuerySchema>,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const where: Prisma.PurchaseOrderWhereInput = {};
      if (q.companyId) where.companyId = q.companyId;
      if (q.vendorId) where.vendorId = q.vendorId;
      if (q.status) where.status = q.status;
      const rows = await tx.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 500,
        include: { vendor: { select: { id: true, code: true, name: true } } },
      });
      const out = [];
      for (const o of rows) {
        if (!(await this.canSeeOrder(tx, tenant, o, auth.user.id))) continue;
        out.push({
          id: o.id,
          number: o.number,
          companyId: o.companyId,
          vendor: o.vendor,
          status: o.status,
          orderDate: iso(o.orderDate),
          total: num(o.total),
          currency: o.currency,
        });
      }
      return out;
    });
  }

  /** Records goods that arrived. Quantities can't exceed what is still outstanding on each line. */
  async receive(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof receiveGoodsSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM purchase_order WHERE id = ${id}::uuid FOR UPDATE`;
      const o = await tx.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
      if (!o) throw new NotFoundError('Purchase order');
      this.requireManage(tenant, o.companyId);
      if (o.status !== 'APPROVED' && o.status !== 'PARTIALLY_RECEIVED') {
        throw new AppError('ORDER_NOT_OPEN', 'Goods can be received only against an approved order', 409);
      }
      const byId = new Map(o.lines.map((l) => [l.id, l]));
      const seen = new Set<string>();
      input.lines.forEach((l, i) => {
        const line = byId.get(l.orderLineId);
        if (!line || seen.has(l.orderLineId))
          throw invalid(`lines.${i}.orderLineId`, 'Choose a line on this order');
        seen.add(l.orderLineId);
        const outstanding = milli(num(line.quantity)) - milli(num(line.receivedQuantity));
        if (milli(l.quantity) > outstanding) {
          throw invalid(`lines.${i}.quantity`, `Only ${outstanding / 1000} still to receive on this line`);
        }
      });
      const number = await this.nextNumber(tx, tenant.id, 'GRN');
      const receipt = await tx.goodsReceipt.create({
        data: {
          tenantId: tenant.id,
          orderId: id,
          number,
          receivedOn: toDate(input.receivedOn),
          note: input.note ?? null,
          receivedByUserId: auth.user.id,
        },
      });
      await tx.goodsReceiptLine.createMany({
        data: input.lines.map((l) => ({
          tenantId: tenant.id,
          receiptId: receipt.id,
          orderLineId: l.orderLineId,
          quantity: l.quantity,
        })),
      });
      for (const l of input.lines) {
        const line = byId.get(l.orderLineId)!;
        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: { receivedQuantity: (milli(num(line.receivedQuantity)) + milli(l.quantity)) / 1000 },
        });
      }
      const fresh = await tx.purchaseOrderLine.findMany({ where: { orderId: id } });
      const complete = fresh.every((l) => milli(num(l.receivedQuantity)) >= milli(num(l.quantity)));
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED' },
      });
      await this.record(tx, tenant, auth, 'procurement.order.receive', 'purchase_order', id, meta, {
        receipt: number,
      });
      return this.orderView(tx, id);
    });
  }
}
