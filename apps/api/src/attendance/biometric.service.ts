import { Injectable } from '@nestjs/common';
import { isUniqueViolation } from '@smart-hr/database';
import { AppError, ForbiddenError, NotFoundError } from '@smart-hr/shared';
import type { biometricDeviceSchema, biometricDeviceUpdateSchema, biometricLinkSchema, biometricLogQuerySchema } from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { BiometricIngestService } from './biometric-ingest.service.js';
import { AttendanceService } from './attendance.service.js';

const nameOf = (e: { firstName: string; lastName: string | null; preferredName: string | null }) =>
  `${e.preferredName ?? e.firstName} ${e.lastName ?? ''}`.trim();

/**
 * Setting up biometric machines: registering them, linking each machine's user numbers to employees, and
 * seeing what the machines have sent. All of it needs `attendance.configure` for the whole organisation.
 */
@Injectable()
export class BiometricService {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly ingest: BiometricIngestService,
    private readonly audit: AuditService,
  ) {}

  private requireConfigure(tenant: TenantContext) {
    if (!tenant.permissions.allowsTenantWide('attendance.configure')) throw new ForbiddenError();
  }

  async devices(tenant: TenantContext, auth: AuthContext) {
    this.requireConfigure(tenant);
    return this.attendance.run(tenant, auth, async (tx) => {
      const devices = await tx.biometricDevice.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }] });
      const waiting = await tx.biometricLog.groupBy({ by: ['deviceId'], where: { outcome: 'UNMAPPED' }, _count: true });
      const unmapped = new Map(waiting.map((w) => [w.deviceId, w._count]));
      return {
        devices: devices.map((d) => ({
          id: d.id,
          name: d.name,
          vendor: d.vendor,
          serialNumber: d.serialNumber,
          location: d.location,
          timeZone: d.timeZone,
          status: d.status,
          lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
          lastPunchAt: d.lastPunchAt?.toISOString() ?? null,
          unmapped: unmapped.get(d.id) ?? 0,
        })),
      };
    });
  }

  async createDevice(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof biometricDeviceSchema>,
    meta: RequestMeta,
  ) {
    this.requireConfigure(tenant);
    return this.attendance.run(tenant, auth, async (tx) => {
      let device;
      try {
        device = await tx.biometricDevice.create({
          data: {
            tenantId: tenant.id,
            name: input.name,
            vendor: input.vendor,
            serialNumber: input.serialNumber,
            location: input.location ?? null,
            timeZone: input.timeZone,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError('SERIAL_TAKEN', 'A machine with this serial number is already registered', 409, [
            { path: 'serialNumber', message: 'Already registered' },
          ]);
        }
        throw error;
      }
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'attendance.biometric.device.create',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'biometric_device',
          targetId: device.id,
          metadata: { serialNumber: device.serialNumber, vendor: device.vendor },
        },
        meta,
      );
      return { id: device.id };
    });
  }

  async updateDevice(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof biometricDeviceUpdateSchema>,
    meta: RequestMeta,
  ) {
    this.requireConfigure(tenant);
    return this.attendance.run(tenant, auth, async (tx) => {
      const found = await tx.biometricDevice.findUnique({ where: { id }, select: { id: true } });
      if (!found) throw new NotFoundError('Machine');
      await tx.biometricDevice.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.location !== undefined ? { location: input.location } : {}),
          ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'attendance.biometric.device.update',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'biometric_device',
          targetId: id,
          metadata: { changed: Object.keys(input) },
        },
        meta,
      );
      return { id };
    });
  }

  /** Who is linked to which user number, and the numbers that have scanned but belong to nobody yet. */
  async links(tenant: TenantContext, auth: AuthContext) {
    this.requireConfigure(tenant);
    return this.attendance.run(tenant, auth, async (tx) => {
      const links = await tx.biometricEnrollment.findMany({
        orderBy: { createdAt: 'desc' },
        include: { employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, preferredName: true } } },
      });
      const waiting = await tx.biometricLog.groupBy({
        by: ['deviceCode'],
        where: { outcome: 'UNMAPPED' },
        _count: true,
        _max: { punchedAt: true },
        orderBy: { deviceCode: 'asc' },
        take: 200,
      });
      return {
        links: links.map((l) => ({
          id: l.id,
          deviceCode: l.deviceCode,
          employee: { id: l.employee.id, code: l.employee.employeeCode, name: nameOf(l.employee) },
        })),
        unlinked: waiting.map((w) => ({
          deviceCode: w.deviceCode,
          scans: w._count,
          lastScanAt: w._max.punchedAt?.toISOString() ?? null,
        })),
      };
    });
  }

  async link(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof biometricLinkSchema>,
    meta: RequestMeta,
  ) {
    this.requireConfigure(tenant);
    return this.attendance.run(tenant, auth, async (tx) => {
      const employee = await tx.employee.findUnique({ where: { id: input.employeeId }, select: { id: true } });
      if (!employee) throw new NotFoundError('Employee');
      let link;
      try {
        link = await tx.biometricEnrollment.create({
          data: { tenantId: tenant.id, employeeId: input.employeeId, deviceCode: input.deviceCode },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError('ALREADY_LINKED', 'That user ID, or that employee, is already linked', 409, [
            { path: 'deviceCode', message: 'Already linked' },
          ]);
        }
        throw error;
      }
      const imported = await this.ingest.applyPending(tx, input.deviceCode, input.employeeId);
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'attendance.biometric.link',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'employee',
          targetId: input.employeeId,
          metadata: { deviceCode: input.deviceCode, imported },
        },
        meta,
      );
      return { id: link.id, imported };
    });
  }

  async unlink(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    this.requireConfigure(tenant);
    return this.attendance.run(tenant, auth, async (tx) => {
      const link = await tx.biometricEnrollment.findUnique({ where: { id } });
      if (!link) throw new NotFoundError('Link');
      await tx.biometricEnrollment.delete({ where: { id } });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'attendance.biometric.unlink',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'employee',
          targetId: link.employeeId,
          metadata: { deviceCode: link.deviceCode },
        },
        meta,
      );
      return { id };
    });
  }

  async logs(tenant: TenantContext, auth: AuthContext, q: z.output<typeof biometricLogQuerySchema>) {
    this.requireConfigure(tenant);
    return this.attendance.run(tenant, auth, async (tx) => {
      const rows = await tx.biometricLog.findMany({
        where: q.outcome ? { outcome: q.outcome } : {},
        orderBy: { punchedAt: 'desc' },
        take: q.limit,
        include: {
          device: { select: { name: true } },
          employee: { select: { firstName: true, lastName: true, preferredName: true } },
        },
      });
      return {
        logs: rows.map((r) => ({
          id: r.id,
          device: r.device.name,
          deviceCode: r.deviceCode,
          punchedAt: r.punchedAt.toISOString(),
          outcome: r.outcome,
          employee: r.employee ? nameOf(r.employee) : null,
        })),
      };
    });
  }
}
