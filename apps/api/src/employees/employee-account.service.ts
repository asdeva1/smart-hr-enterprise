import { Injectable } from '@nestjs/common';
import { normalizeEmail } from '@smart-hr/auth';
import { AppError } from '@smart-hr/shared';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { EmployeesService } from './employees.service.js';
import { OrgIndex } from './org-index.js';

/**
 * Gives an employee a sign-in account, using their work email. Inviting goes through the normal member
 * invitation (so access.manage and the members limit apply), then links the membership to the record.
 */
@Injectable()
export class EmployeeAccountService {
  constructor(
    private readonly employees: EmployeesService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async invite(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    roleId: string | undefined,
    meta: RequestMeta,
  ) {
    const e = await this.employees.run(tenant, auth, async (tx) => {
      const employee = await this.employees.load(
        tx,
        tenant,
        await OrgIndex.load(tx, tenant.id),
        id,
        'employees.manage',
      );
      if (employee.status === 'EXITED')
        throw new AppError('INVALID_STATUS', 'Leavers can’t be given sign-in access', 409);
      if (employee.membershipId)
        throw new AppError('ALREADY_LINKED', 'This employee can already sign in', 409);
      if (!employee.workEmail) {
        throw new AppError('NO_WORK_EMAIL', 'Add a work email first; the invitation is sent there', 400, [
          { path: 'workEmail', message: 'Required to invite' },
        ]);
      }
      const role =
        roleId ??
        (await tx.role.findFirst({ where: { key: 'member', isSystem: true }, select: { id: true } }))?.id;
      if (!role) throw new AppError('NO_ROLE', 'Choose a role', 400);
      return { ...employee, workEmail: employee.workEmail, roleId: role };
    });

    let membershipId: string;
    try {
      ({ membershipId } = await this.access.invite(
        tenant,
        auth,
        {
          email: e.workEmail,
          displayName: `${e.preferredName || e.firstName} ${e.lastName}`,
          // Their role applies in their own company; administrators can widen it later.
          assignments: [{ roleId: e.roleId, scopeType: 'COMPANY', scopeId: e.companyId }],
        },
        meta,
      ));
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'ALREADY_MEMBER') throw error;
      // Already a member (for example an administrator who is also an employee): link that membership.
      membershipId = await this.employees.run(tenant, auth, async (tx) => {
        const m = await tx.tenantMembership.findFirst({
          where: { user: { email: normalizeEmail(e.workEmail) } },
          select: { id: true },
        });
        if (!m) throw error;
        return m.id;
      });
    }

    return this.employees.run(tenant, auth, async (tx) => {
      const linked = await tx.employee.findFirst({ where: { membershipId }, select: { employeeCode: true } });
      if (linked) {
        throw new AppError(
          'ALREADY_LINKED',
          `That sign-in account already belongs to employee ${linked.employeeCode}`,
          409,
        );
      }
      await tx.employee.update({ where: { id }, data: { membershipId } });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'employee.account.link',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'employee',
          targetId: id,
          metadata: { membershipId },
        },
        meta,
      );
      return { membershipId };
    });
  }
}
