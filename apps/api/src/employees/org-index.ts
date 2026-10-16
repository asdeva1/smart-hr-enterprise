import type { TenantTransaction } from '@smart-hr/database';
import { AppError, type Permission, type PermissionSet, type ScopeRef } from '@smart-hr/shared';

interface Placement {
  companyId: string;
  branchId: string | null;
  departmentId: string | null;
}

/**
 * The organisation's companies, branches and department tree, loaded once per request so employee scope
 * checks and list filters don't query per row. Loaded inside the tenant transaction, so RLS limits it to
 * the caller's organisation.
 */
export class OrgIndex {
  private constructor(
    private readonly tenantId: string,
    readonly companies: Map<string, { code: string; name: string; status: string }>,
    readonly branches: Map<string, { companyId: string; code: string; name: string; status: string }>,
    readonly departments: Map<
      string,
      { companyId: string; parentId: string | null; code: string; name: string; status: string }
    >,
  ) {}

  static async load(tx: TenantTransaction, tenantId: string): Promise<OrgIndex> {
    const [companies, branches, departments] = [
      await tx.company.findMany({ select: { id: true, code: true, name: true, status: true } }),
      await tx.branch.findMany({
        select: { id: true, companyId: true, code: true, name: true, status: true },
      }),
      await tx.department.findMany({
        select: { id: true, companyId: true, parentId: true, code: true, name: true, status: true },
      }),
    ];
    return new OrgIndex(
      tenantId,
      new Map(companies.map((c) => [c.id, c])),
      new Map(branches.map((b) => [b.id, b])),
      new Map(departments.map((d) => [d.id, d])),
    );
  }

  /** Every scope a placement sits in: tenant, company, branch, department and the department's ancestors. */
  scopesOf(p: Placement): ScopeRef[] {
    const scopes: ScopeRef[] = [
      { type: 'TENANT', id: this.tenantId },
      { type: 'COMPANY', id: p.companyId },
    ];
    if (p.branchId) scopes.push({ type: 'BRANCH', id: p.branchId });
    let current = p.departmentId;
    for (let depth = 0; current && depth < 50; depth++) {
      scopes.push({ type: 'DEPARTMENT', id: current });
      current = this.departments.get(current)?.parentId ?? null;
    }
    return scopes;
  }

  /** Checks that a branch and department belong to the company and are in use. */
  assertPlacement(p: Placement, { allowArchived = false } = {}): void {
    const company = this.companies.get(p.companyId);
    if (!company || (!allowArchived && company.status !== 'ACTIVE')) {
      throw invalid('companyId', 'Choose an active company');
    }
    if (p.branchId) {
      const branch = this.branches.get(p.branchId);
      if (!branch || branch.companyId !== p.companyId || (!allowArchived && branch.status !== 'ACTIVE')) {
        throw invalid('branchId', 'Choose an active branch of this company');
      }
    }
    if (p.departmentId) {
      const dept = this.departments.get(p.departmentId);
      if (!dept || dept.companyId !== p.companyId || (!allowArchived && dept.status !== 'ACTIVE')) {
        throw invalid('departmentId', 'Choose an active department of this company');
      }
    }
  }

  /** A department and everything under it. */
  private subtree(rootId: string): string[] {
    const ids = [rootId];
    for (let i = 0; i < ids.length; i++) {
      for (const [id, d] of this.departments) if (d.parentId === ids[i]) ids.push(id);
    }
    return ids;
  }

  /**
   * A Prisma `where` fragment for the employees a permission lets the member see or act on. `null` means
   * no restriction (owner or tenant-wide). An empty `OR` matches nothing.
   */
  visibilityFilter(permissions: PermissionSet, code: Permission) {
    const held = permissions.scopesFor(code);
    if (held === 'ALL') return null;
    const companyIds = held.filter((s) => s.type === 'COMPANY').map((s) => s.id);
    const branchIds = held.filter((s) => s.type === 'BRANCH').map((s) => s.id);
    const departmentIds = held.filter((s) => s.type === 'DEPARTMENT').flatMap((s) => this.subtree(s.id));
    return {
      OR: [
        ...(companyIds.length ? [{ companyId: { in: companyIds } }] : []),
        ...(branchIds.length ? [{ branchId: { in: branchIds } }] : []),
        ...(departmentIds.length ? [{ departmentId: { in: departmentIds } }] : []),
      ],
    };
  }
}

function invalid(path: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, 400, [{ path, message }]);
}
