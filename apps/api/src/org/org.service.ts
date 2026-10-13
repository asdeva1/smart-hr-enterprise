import { Inject, Injectable } from '@nestjs/common';
import {
  isUniqueViolation,
  withContext,
  type DatabaseClient,
  type RecordStatus,
  type TenantTransaction,
} from '@smart-hr/database';
import {
  AppError,
  defined,
  ForbiddenError,
  NotFoundError,
  type Permission,
  type ScopeRef,
} from '@smart-hr/shared';
import {
  createBranchSchema,
  createCompanySchema,
  createDepartmentSchema,
  updateBranchSchema,
  updateCompanySchema,
  updateDepartmentSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { DATABASE } from '../infra/tokens.js';
import { RbacService } from '../rbac/rbac.service.js';

type CreateCompany = z.output<typeof createCompanySchema>;
type UpdateCompany = z.output<typeof updateCompanySchema>;
type CreateBranch = z.output<typeof createBranchSchema>;
type UpdateBranch = z.output<typeof updateBranchSchema>;
type CreateDepartment = z.output<typeof createDepartmentSchema>;
type UpdateDepartment = z.output<typeof updateDepartmentSchema>;

const COMPANY_SELECT = {
  id: true,
  code: true,
  name: true,
  legalName: true,
  country: true,
  baseCurrency: true,
  timezone: true,
  status: true,
  updatedAt: true,
} as const;
const BRANCH_SELECT = {
  id: true,
  companyId: true,
  code: true,
  name: true,
  city: true,
  country: true,
  timezone: true,
  status: true,
  updatedAt: true,
} as const;
const DEPARTMENT_SELECT = {
  id: true,
  companyId: true,
  parentId: true,
  code: true,
  name: true,
  status: true,
  updatedAt: true,
} as const;

function codeTaken(kind: string): AppError {
  return new AppError('CODE_TAKEN', `Another ${kind} already uses this code`, 409, [
    { path: 'code', message: 'This code is already in use' },
  ]);
}

/** Only fields that actually changed, for audit metadata. */
function changedFields(before: Record<string, unknown>, patch: Record<string, unknown>) {
  return Object.keys(patch).filter((key) => patch[key] !== undefined && patch[key] !== before[key]);
}

/**
 * Companies, branches and departments. Every query runs inside the caller's tenant transaction, so RLS
 * hides other tenants; permissions are checked against the scope of the specific record.
 */
@Injectable()
export class OrgService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  private run<T>(tenant: TenantContext, auth: AuthContext, work: (tx: TenantTransaction) => Promise<T>) {
    return withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, work);
  }

  private require(tenant: TenantContext, code: Permission, scopes: ScopeRef[]): void {
    if (!tenant.permissions.allows(code, scopes)) throw new ForbiddenError();
  }

  // ---- Companies ----------------------------------------------------------------------------

  async listCompanies(tenant: TenantContext, auth: AuthContext, status?: RecordStatus) {
    const companies = await this.run(tenant, auth, (tx) =>
      tx.company.findMany({
        where: status ? { status } : {},
        orderBy: { name: 'asc' },
        select: COMPANY_SELECT,
      }),
    );
    return companies.filter((c) =>
      tenant.permissions.allows('org.view', this.rbac.companyScopes(tenant.id, c.id)),
    );
  }

  async createCompany(tenant: TenantContext, auth: AuthContext, input: CreateCompany, meta: RequestMeta) {
    // A new legal entity is a tenant-wide decision.
    this.require(tenant, 'org.manage', this.rbac.tenantScope(tenant.id));
    return this.run(tenant, auth, async (tx) => {
      try {
        const company = await tx.company.create({
          data: { tenantId: tenant.id, ...input, legalName: input.legalName ?? null },
          select: COMPANY_SELECT,
        });
        await this.audit.recordInTransaction(
          tx,
          {
            action: 'org.company.create',
            outcome: 'SUCCESS',
            tenantId: tenant.id,
            actorUserId: auth.user.id,
            targetType: 'company',
            targetId: company.id,
            metadata: { code: company.code },
          },
          meta,
        );
        return company;
      } catch (error) {
        if (isUniqueViolation(error)) throw codeTaken('company');
        throw error;
      }
    });
  }

  async updateCompany(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: UpdateCompany,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const existing = await tx.company.findUnique({ where: { id }, select: COMPANY_SELECT });
      if (!existing) throw new NotFoundError('Company');
      this.require(tenant, 'org.manage', this.rbac.companyScopes(tenant.id, id));

      if (input.status === 'ARCHIVED' && existing.status !== 'ARCHIVED') {
        const active =
          (await tx.branch.count({ where: { companyId: id, status: 'ACTIVE' } })) +
          (await tx.department.count({ where: { companyId: id, status: 'ACTIVE' } }));
        if (active > 0) {
          throw new AppError(
            'HAS_ACTIVE_CHILDREN',
            'Archive this company’s branches and departments first',
            409,
          );
        }
      }
      const updated = await tx.company.update({
        where: { id },
        data: defined(input),
        select: COMPANY_SELECT,
      });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'org.company.update',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'company',
          targetId: id,
          metadata: { fields: changedFields(existing, input) },
        },
        meta,
      );
      return updated;
    });
  }

  // ---- Branches -----------------------------------------------------------------------------

  async listBranches(tenant: TenantContext, auth: AuthContext, companyId?: string, status?: RecordStatus) {
    const branches = await this.run(tenant, auth, (tx) =>
      tx.branch.findMany({
        where: { ...(companyId ? { companyId } : {}), ...(status ? { status } : {}) },
        orderBy: { name: 'asc' },
        select: BRANCH_SELECT,
      }),
    );
    return branches.filter((b) =>
      tenant.permissions.allows('org.view', [
        ...this.rbac.companyScopes(tenant.id, b.companyId),
        { type: 'BRANCH', id: b.id },
      ]),
    );
  }

  async createBranch(tenant: TenantContext, auth: AuthContext, input: CreateBranch, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: input.companyId },
        select: { id: true, status: true },
      });
      if (!company) throw new NotFoundError('Company');
      this.require(tenant, 'org.manage', this.rbac.companyScopes(tenant.id, company.id));
      if (company.status !== 'ACTIVE') {
        throw new AppError('COMPANY_ARCHIVED', 'Branches can’t be added to an archived company', 409);
      }
      try {
        const branch = await tx.branch.create({
          data: {
            tenantId: tenant.id,
            companyId: company.id,
            code: input.code,
            name: input.name,
            city: input.city ?? null,
            country: input.country ?? null,
            timezone: input.timezone ?? null,
          },
          select: BRANCH_SELECT,
        });
        await this.audit.recordInTransaction(
          tx,
          {
            action: 'org.branch.create',
            outcome: 'SUCCESS',
            tenantId: tenant.id,
            actorUserId: auth.user.id,
            targetType: 'branch',
            targetId: branch.id,
            metadata: { code: branch.code, companyId: company.id },
          },
          meta,
        );
        return branch;
      } catch (error) {
        if (isUniqueViolation(error)) throw codeTaken('branch');
        throw error;
      }
    });
  }

  async updateBranch(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: UpdateBranch,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const existing = await tx.branch.findUnique({ where: { id }, select: BRANCH_SELECT });
      if (!existing) throw new NotFoundError('Branch');
      this.require(tenant, 'org.manage', await this.rbac.branchScopes(tx, tenant.id, id));
      const updated = await tx.branch.update({ where: { id }, data: defined(input), select: BRANCH_SELECT });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'org.branch.update',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'branch',
          targetId: id,
          metadata: { fields: changedFields(existing, input) },
        },
        meta,
      );
      return updated;
    });
  }

  // ---- Departments --------------------------------------------------------------------------

  async listDepartments(tenant: TenantContext, auth: AuthContext, companyId?: string, status?: RecordStatus) {
    return this.run(tenant, auth, async (tx) => {
      // Load the whole tree once so ancestry checks don't need a query per department.
      const all = await tx.department.findMany({ orderBy: { name: 'asc' }, select: DEPARTMENT_SELECT });
      const byId = new Map(all.map((d) => [d.id, d]));
      const scopesOf = (dept: (typeof all)[number]): ScopeRef[] => {
        const scopes: ScopeRef[] = this.rbac.companyScopes(tenant.id, dept.companyId);
        let current: (typeof all)[number] | undefined = dept;
        for (let depth = 0; current && depth < 32; depth++) {
          scopes.push({ type: 'DEPARTMENT', id: current.id });
          current = current.parentId ? byId.get(current.parentId) : undefined;
        }
        return scopes;
      };
      return all.filter(
        (d) =>
          (!companyId || d.companyId === companyId) &&
          (!status || d.status === status) &&
          tenant.permissions.allows('org.view', scopesOf(d)),
      );
    });
  }

  async createDepartment(
    tenant: TenantContext,
    auth: AuthContext,
    input: CreateDepartment,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: input.companyId },
        select: { id: true, status: true },
      });
      if (!company) throw new NotFoundError('Company');
      if (company.status !== 'ACTIVE') {
        throw new AppError('COMPANY_ARCHIVED', 'Departments can’t be added to an archived company', 409);
      }
      let scopes = this.rbac.companyScopes(tenant.id, company.id);
      if (input.parentId) {
        const parent = await tx.department.findUnique({
          where: { id: input.parentId },
          select: { companyId: true, status: true },
        });
        if (!parent) throw new NotFoundError('Parent department');
        if (parent.companyId !== company.id) {
          throw new AppError(
            'PARENT_OTHER_COMPANY',
            'The parent department belongs to another company',
            400,
            [{ path: 'parentId', message: 'Choose a department of the same company' }],
          );
        }
        scopes = await this.rbac.departmentScopes(tx, tenant.id, input.parentId);
      }
      this.require(tenant, 'org.manage', scopes);
      try {
        const dept = await tx.department.create({
          data: {
            tenantId: tenant.id,
            companyId: company.id,
            parentId: input.parentId ?? null,
            code: input.code,
            name: input.name,
          },
          select: DEPARTMENT_SELECT,
        });
        await this.audit.recordInTransaction(
          tx,
          {
            action: 'org.department.create',
            outcome: 'SUCCESS',
            tenantId: tenant.id,
            actorUserId: auth.user.id,
            targetType: 'department',
            targetId: dept.id,
            metadata: { code: dept.code, companyId: company.id, parentId: dept.parentId },
          },
          meta,
        );
        return dept;
      } catch (error) {
        if (isUniqueViolation(error)) throw codeTaken('department');
        throw error;
      }
    });
  }

  async updateDepartment(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: UpdateDepartment,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const existing = await tx.department.findUnique({ where: { id }, select: DEPARTMENT_SELECT });
      if (!existing) throw new NotFoundError('Department');
      this.require(tenant, 'org.manage', await this.rbac.departmentScopes(tx, tenant.id, id));

      if (input.parentId !== undefined && input.parentId !== existing.parentId) {
        if (input.parentId !== null) {
          const parentScopes = await this.rbac.departmentScopes(tx, tenant.id, input.parentId);
          if (parentScopes.some((s) => s.type === 'DEPARTMENT' && s.id === id)) {
            throw new AppError('DEPARTMENT_CYCLE', 'A department can’t be moved under itself', 400, [
              { path: 'parentId', message: 'Choose a department outside this one' },
            ]);
          }
          const parent = await tx.department.findUnique({
            where: { id: input.parentId },
            select: { companyId: true },
          });
          if (parent?.companyId !== existing.companyId) {
            throw new AppError(
              'PARENT_OTHER_COMPANY',
              'The parent department belongs to another company',
              400,
              [{ path: 'parentId', message: 'Choose a department of the same company' }],
            );
          }
          // Moving into a part of the organisation needs permission there too.
          this.require(tenant, 'org.manage', parentScopes);
        } else {
          this.require(tenant, 'org.manage', this.rbac.companyScopes(tenant.id, existing.companyId));
        }
      }

      if (input.status === 'ARCHIVED' && existing.status !== 'ARCHIVED') {
        const activeChildren = await tx.department.count({ where: { parentId: id, status: 'ACTIVE' } });
        if (activeChildren > 0) {
          throw new AppError('HAS_ACTIVE_CHILDREN', 'Archive or move its sub-departments first', 409);
        }
      }

      const updated = await tx.department.update({
        where: { id },
        data: defined(input),
        select: DEPARTMENT_SELECT,
      });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'org.department.update',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'department',
          targetId: id,
          metadata: { fields: changedFields(existing, input) },
        },
        meta,
      );
      return updated;
    });
  }
}
