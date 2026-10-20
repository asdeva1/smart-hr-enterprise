import { Injectable } from '@nestjs/common';
import { isUniqueViolation, type Prisma, type TenantTransaction } from '@smart-hr/database';
import { AppError, NotFoundError } from '@smart-hr/shared';
import type { updateVendorSchema, vendorListQuerySchema, vendorSchema } from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { AttendanceService } from '../attendance/attendance.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';

type VendorRow = Awaited<ReturnType<TenantTransaction['vendor']['findUniqueOrThrow']>>;

function view(v: VendorRow) {
  return {
    id: v.id,
    code: v.code,
    name: v.name,
    gstin: v.gstin,
    pan: v.pan,
    contactName: v.contactName,
    email: v.email,
    phone: v.phone,
    address: v.address,
    paymentTermsDays: v.paymentTermsDays,
    notes: v.notes,
    status: v.status,
  };
}

/** The vendor master: who the organisation buys from. Shared by every company. */
@Injectable()
export class VendorsService {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly audit: AuditService,
  ) {}

  private record(
    tx: TenantTransaction,
    tenant: TenantContext,
    auth: AuthContext,
    action: string,
    id: string,
    meta: RequestMeta,
  ) {
    return this.audit.recordInTransaction(
      tx,
      {
        action,
        outcome: 'SUCCESS',
        tenantId: tenant.id,
        actorUserId: auth.user.id,
        targetType: 'vendor',
        targetId: id,
      },
      meta,
    );
  }

  list(tenant: TenantContext, auth: AuthContext, q: z.output<typeof vendorListQuerySchema>) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const where: Prisma.VendorWhereInput = {};
      if (q.status) where.status = q.status;
      if (q.q) {
        where.OR = [
          { name: { contains: q.q, mode: 'insensitive' } },
          { code: { contains: q.q, mode: 'insensitive' } },
        ];
      }
      return (await tx.vendor.findMany({ where, orderBy: { name: 'asc' }, take: 1000 })).map(view);
    });
  }

  get(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const v = await tx.vendor.findUnique({ where: { id } });
      if (!v) throw new NotFoundError('Vendor');
      return view(v);
    });
  }

  create(tenant: TenantContext, auth: AuthContext, input: z.output<typeof vendorSchema>, meta: RequestMeta) {
    return this.attendance.run(tenant, auth, async (tx) => {
      try {
        const v = await tx.vendor.create({
          data: {
            tenantId: tenant.id,
            code: input.code.toUpperCase(),
            name: input.name,
            gstin: input.gstin ?? null,
            pan: input.pan ?? null,
            contactName: input.contactName ?? null,
            email: input.email ?? null,
            phone: input.phone ?? null,
            address: input.address ?? null,
            paymentTermsDays: input.paymentTermsDays,
            notes: input.notes ?? null,
          },
        });
        await this.record(tx, tenant, auth, 'vendors.create', v.id, meta);
        return view(v);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError('VALIDATION_FAILED', 'That vendor code is already used', 400, [
            { path: 'code', message: 'That vendor code is already used' },
          ]);
        }
        throw error;
      }
    });
  }

  update(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateVendorSchema>,
    meta: RequestMeta,
  ) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const existing = await tx.vendor.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError('Vendor');
      const data: Prisma.VendorUpdateInput = {};
      for (const key of [
        'name',
        'gstin',
        'pan',
        'contactName',
        'email',
        'phone',
        'address',
        'paymentTermsDays',
        'notes',
        'status',
      ] as const) {
        if (input[key] !== undefined) (data as Record<string, unknown>)[key] = input[key];
      }
      const v = await tx.vendor.update({ where: { id }, data });
      await this.record(tx, tenant, auth, 'vendors.update', id, meta);
      return view(v);
    });
  }
}
