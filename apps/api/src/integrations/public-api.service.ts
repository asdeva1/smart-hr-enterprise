import { Inject, Injectable } from '@nestjs/common';
import { withContext, type DatabaseClient } from '@smart-hr/database';
import type { VerifiedKey } from './api-keys.service.js';
import { DATABASE } from '../infra/tokens.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * What outside systems can read with an API key. Deliberately small: a directory of people, without personal
 * identity numbers, bank details, pay or documents.
 */
@Injectable()
export class PublicApiService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly entitlements: EntitlementsService,
  ) {}

  employees(key: VerifiedKey, q: { page: number; pageSize: number; status: 'CURRENT' | 'ALL' }) {
    return withContext(this.db, { tenantId: key.tenantId }, async (tx) => {
      // Keys stop working when the plan no longer includes integrations.
      this.entitlements.assertFeature(await this.entitlements.forTenant(tx), 'integrations.custom', false);
      const where = q.status === 'ALL' ? {} : { status: { in: ['ACTIVE' as const, 'ON_NOTICE' as const] } };
      const [total, rows] = await Promise.all([
        tx.employee.count({ where }),
        tx.employee.findMany({
          where,
          orderBy: [{ employeeCode: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            workEmail: true,
            status: true,
            dateOfJoining: true,
            lastWorkingDay: true,
            company: { select: { code: true } },
            department: { select: { code: true, name: true } },
            designation: { select: { name: true } },
            manager: { select: { employeeCode: true } },
          },
        }),
      ]);
      return {
        total,
        page: q.page,
        pageSize: q.pageSize,
        items: rows.map((e) => ({
          id: e.id,
          employeeCode: e.employeeCode,
          firstName: e.firstName,
          lastName: e.lastName,
          workEmail: e.workEmail,
          status: e.status,
          dateOfJoining: iso(e.dateOfJoining),
          lastWorkingDay: iso(e.lastWorkingDay),
          companyCode: e.company.code,
          department: e.department ? { code: e.department.code, name: e.department.name } : null,
          designation: e.designation?.name ?? null,
          managerCode: e.manager?.employeeCode ?? null,
        })),
      };
    });
  }
}
