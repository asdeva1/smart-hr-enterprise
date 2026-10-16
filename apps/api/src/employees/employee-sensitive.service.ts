import { Inject, Injectable } from '@nestjs/common';
import { SecretBox } from '@smart-hr/auth';
import { AppError } from '@smart-hr/shared';
import type { employeeSensitiveSchema } from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import type { ApiEnv } from '../config/env.js';
import { API_ENV } from '../infra/tokens.js';
import { EmployeesService } from './employees.service.js';
import { OrgIndex } from './org-index.js';

type SensitiveInput = z.output<typeof employeeSensitiveSchema>;
const SEALED = ['pan', 'aadhaar', 'bankAccount'] as const;
type SealedField = (typeof SEALED)[number];

const mask = (last4: string | null) => (last4 ? `•••• ${last4}` : null);

/**
 * PAN, Aadhaar and bank details. Numbers are sealed with AES-256-GCM, bound to the organisation, employee
 * and field, so a value copied to another row or column fails to decrypt. Reading shows masked values;
 * seeing full values needs employees.sensitive.view plus a recent password entry, and every reveal is audited.
 */
@Injectable()
export class EmployeeSensitiveService {
  private readonly box: SecretBox;

  constructor(
    @Inject(API_ENV) env: ApiEnv,
    private readonly employees: EmployeesService,
    private readonly audit: AuditService,
  ) {
    this.box = new SecretBox(env.DATA_ENCRYPTION_KEYS, env.DATA_ENCRYPTION_KEY_ID);
  }

  private aad(tenantId: string, employeeId: string, field: SealedField) {
    return `employee-sensitive:${tenantId}:${employeeId}:${field}`;
  }

  /** Masked view: last four characters only. */
  async masked(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.employees.run(tenant, auth, async (tx) => {
      await this.employees.load(
        tx,
        tenant,
        await OrgIndex.load(tx, tenant.id),
        id,
        'employees.sensitive.view',
      );
      const s = await tx.employeeSensitive.findUnique({ where: { employeeId: id } });
      return {
        pan: mask(s?.panLast4 ?? null),
        aadhaar: mask(s?.aadhaarLast4 ?? null),
        bankAccount: mask(s?.bankAccountLast4 ?? null),
        bankIfsc: s?.bankIfsc ?? null,
        bankName: s?.bankName ?? null,
        uan: s?.uan ?? null,
        updatedAt: s?.updatedAt ?? null,
      };
    });
  }

  async reveal(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.employees.run(tenant, auth, async (tx) => {
      await this.employees.load(
        tx,
        tenant,
        await OrgIndex.load(tx, tenant.id),
        id,
        'employees.sensitive.view',
      );
      const s = await tx.employeeSensitive.findUnique({ where: { employeeId: id } });
      const open = (field: SealedField, sealed: string | null | undefined) => {
        if (!sealed) return null;
        try {
          return this.box.decrypt(sealed, this.aad(tenant.id, id, field));
        } catch {
          // Tampered, copied from another record, or sealed with a key this server no longer has.
          throw new AppError(
            'SENSITIVE_UNREADABLE',
            'A stored value can’t be read. It may have been changed outside Smart HR. Enter it again.',
            500,
            [{ path: field, message: 'Can’t be read' }],
          );
        }
      };
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'employee.sensitive.reveal',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'employee',
          targetId: id,
        },
        meta,
      );
      return {
        pan: open('pan', s?.panSealed),
        aadhaar: open('aadhaar', s?.aadhaarSealed),
        bankAccount: open('bankAccount', s?.bankAccountSealed),
        bankIfsc: s?.bankIfsc ?? null,
        bankName: s?.bankName ?? null,
        uan: s?.uan ?? null,
      };
    });
  }

  async update(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: SensitiveInput,
    meta: RequestMeta,
  ) {
    await this.employees.run(tenant, auth, async (tx) => {
      await this.employees.load(
        tx,
        tenant,
        await OrgIndex.load(tx, tenant.id),
        id,
        'employees.sensitive.manage',
      );
      const data: Record<string, string | null> = {};
      for (const field of SEALED) {
        const value = input[field];
        if (value === undefined) continue;
        data[`${field}Sealed`] =
          value === null ? null : this.box.encrypt(value, this.aad(tenant.id, id, field));
        data[`${field}Last4`] = value === null ? null : value.slice(-4);
      }
      for (const field of ['bankIfsc', 'bankName', 'uan'] as const) {
        if (input[field] !== undefined) data[field] = input[field];
      }
      await tx.employeeSensitive.upsert({
        where: { employeeId: id },
        create: { tenantId: tenant.id, employeeId: id, ...data, updatedByUserId: auth.user.id },
        update: { ...data, updatedByUserId: auth.user.id },
      });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'employee.sensitive.update',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'employee',
          targetId: id,
          // Which fields changed, never their values.
          metadata: {
            fields: Object.keys(input).filter((k) => input[k as keyof SensitiveInput] !== undefined),
          },
        },
        meta,
      );
    });
    return this.masked(tenant, auth, id);
  }

  /**
   * Full values for the organisation's own data export (owners only, recent sign-in, audited by the export).
   * A value that can't be decrypted is left out and named in `unreadable`, so one bad row can't block the export.
   */
  decryptForExport(row: {
    tenantId: string;
    employeeId: string;
    panSealed: string | null;
    aadhaarSealed: string | null;
    bankAccountSealed: string | null;
  }) {
    const unreadable: SealedField[] = [];
    const open = (field: SealedField, sealed: string | null) => {
      if (!sealed) return null;
      try {
        return this.box.decrypt(sealed, this.aad(row.tenantId, row.employeeId, field));
      } catch {
        unreadable.push(field);
        return null;
      }
    };
    return {
      pan: open('pan', row.panSealed),
      aadhaar: open('aadhaar', row.aadhaarSealed),
      bankAccount: open('bankAccount', row.bankAccountSealed),
      unreadable,
    };
  }
}
