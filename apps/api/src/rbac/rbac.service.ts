import { Injectable } from '@nestjs/common';
import type { ScopeType, TenantTransaction } from '@smart-hr/database';
import { NotFoundError, PermissionSet, SYSTEM_ROLES, type ScopeRef } from '@smart-hr/shared';

const MAX_DEPARTMENT_DEPTH = 32;

/** The shape loaded with a membership to build its permission set in one query. */
export const ASSIGNMENT_SELECT = {
  scopeType: true,
  scopeId: true,
  role: { select: { permissions: { select: { permission: true } } } },
} as const;

export function permissionSetFrom(
  tenantId: string,
  isOwner: boolean,
  assignments: {
    scopeType: ScopeType;
    scopeId: string;
    role: { permissions: { permission: string }[] };
  }[],
): PermissionSet {
  return new PermissionSet(
    tenantId,
    isOwner,
    assignments.map((a) => ({
      permissions: a.role.permissions.map((p) => p.permission),
      scope: { type: a.scopeType, id: a.scopeId },
    })),
  );
}

/**
 * Resolves where things sit in the organisation, for scope-aware permission checks.
 * Every lookup runs in the caller's tenant transaction, so RLS hides other tenants' records: an id from
 * another tenant is reported as not found.
 */
@Injectable()
export class RbacService {
  tenantScope(tenantId: string): ScopeRef[] {
    return [{ type: 'TENANT', id: tenantId }];
  }

  companyScopes(tenantId: string, companyId: string): ScopeRef[] {
    return [...this.tenantScope(tenantId), { type: 'COMPANY', id: companyId }];
  }

  async branchScopes(tx: TenantTransaction, tenantId: string, branchId: string): Promise<ScopeRef[]> {
    const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { companyId: true } });
    if (!branch) throw new NotFoundError('Branch');
    return [...this.companyScopes(tenantId, branch.companyId), { type: 'BRANCH', id: branchId }];
  }

  /** The department, every ancestor, its company and the tenant. */
  async departmentScopes(tx: TenantTransaction, tenantId: string, departmentId: string): Promise<ScopeRef[]> {
    const scopes: ScopeRef[] = [];
    let companyId: string | null = null;
    let current: string | null = departmentId;
    for (let depth = 0; current && depth < MAX_DEPARTMENT_DEPTH; depth++) {
      const dept: { companyId: string; parentId: string | null } | null = await tx.department.findUnique({
        where: { id: current },
        select: { companyId: true, parentId: true },
      });
      if (!dept) throw new NotFoundError('Department');
      scopes.push({ type: 'DEPARTMENT', id: current });
      companyId = dept.companyId;
      current = dept.parentId;
    }
    return [...this.companyScopes(tenantId, companyId!), ...scopes];
  }

  /** Scopes a role-assignment target sits in, validating that the scope exists in this tenant. */
  async scopesOf(tx: TenantTransaction, tenantId: string, scope: ScopeRef): Promise<ScopeRef[]> {
    switch (scope.type) {
      case 'TENANT':
        return this.tenantScope(tenantId);
      case 'COMPANY': {
        const company = await tx.company.findUnique({ where: { id: scope.id }, select: { id: true } });
        if (!company) throw new NotFoundError('Company');
        return this.companyScopes(tenantId, scope.id);
      }
      case 'BRANCH':
        return this.branchScopes(tx, tenantId, scope.id);
      case 'DEPARTMENT':
        return this.departmentScopes(tx, tenantId, scope.id);
    }
  }

  /** Creates the built-in roles for a tenant, or brings their permissions up to date. Idempotent. */
  async ensureSystemRoles(tx: TenantTransaction, tenantId: string): Promise<void> {
    for (const template of SYSTEM_ROLES) {
      const role = await tx.role.upsert({
        where: { tenantId_key: { tenantId, key: template.key } },
        create: {
          tenantId,
          key: template.key,
          name: template.name,
          description: template.description,
          isSystem: true,
        },
        update: { name: template.name, description: template.description, isSystem: true },
        select: { id: true },
      });
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.rolePermission.createMany({
        data: template.permissions.map((permission) => ({ tenantId, roleId: role.id, permission })),
      });
    }
  }
}
