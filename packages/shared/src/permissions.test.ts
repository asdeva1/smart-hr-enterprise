import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, isPermission, PermissionSet, SYSTEM_ROLES, type ScopeRef } from './permissions.js';

const T = 'tenant-1';
const tenant: ScopeRef = { type: 'TENANT', id: T };
const companyA: ScopeRef = { type: 'COMPANY', id: 'company-a' };
const companyB: ScopeRef = { type: 'COMPANY', id: 'company-b' };
const branchA1: ScopeRef = { type: 'BRANCH', id: 'branch-a1' };
const deptParent: ScopeRef = { type: 'DEPARTMENT', id: 'dept-parent' };
const deptChild: ScopeRef = { type: 'DEPARTMENT', id: 'dept-child' };

describe('PermissionSet', () => {
  it('grants an owner everything, everywhere', () => {
    const set = new PermissionSet(T, true);
    expect(set.codes()).toEqual(ALL_PERMISSIONS);
    expect(set.allows('org.manage', [tenant, companyB])).toBe(true);
    expect(set.allowsTenantWide('access.manage')).toBe(true);
  });

  it('grants nothing without assignments', () => {
    const set = new PermissionSet(T, false);
    expect(set.codes()).toEqual([]);
    expect(set.hasAnywhere('org.view')).toBe(false);
    expect(set.allows('org.view', [tenant])).toBe(false);
  });

  it('applies a tenant-scope grant to every target in that tenant only', () => {
    const set = new PermissionSet(T, false, [{ permissions: ['org.view'], scope: tenant }]);
    expect(set.allows('org.view', [tenant, companyA, branchA1])).toBe(true);
    expect(set.allowsTenantWide('org.view')).toBe(true);
    // A tenant grant from a different tenant id never matches.
    const foreign = new PermissionSet(T, false, [
      { permissions: ['org.view'], scope: { type: 'TENANT', id: 'tenant-2' } },
    ]);
    expect(foreign.allows('org.view', [tenant])).toBe(false);
  });

  it('limits a company grant to targets inside that company', () => {
    const set = new PermissionSet(T, false, [{ permissions: ['org.manage'], scope: companyA }]);
    expect(set.allows('org.manage', [tenant, companyA, branchA1])).toBe(true);
    expect(set.allows('org.manage', [tenant, companyB])).toBe(false);
    expect(set.allowsTenantWide('org.manage')).toBe(false);
    expect(set.hasAnywhere('org.manage')).toBe(true);
  });

  it('applies a department grant to sub-departments when the target lists its ancestors', () => {
    const set = new PermissionSet(T, false, [{ permissions: ['org.view'], scope: deptParent }]);
    expect(set.allows('org.view', [tenant, companyA, deptChild, deptParent])).toBe(true);
    expect(set.allows('org.view', [tenant, companyA, deptChild])).toBe(false);
  });

  it('does not let one permission stand in for another', () => {
    const set = new PermissionSet(T, false, [{ permissions: ['org.view'], scope: tenant }]);
    expect(set.allows('org.manage', [tenant])).toBe(false);
  });
});

describe('catalogue', () => {
  it('only uses known permission codes in system roles', () => {
    for (const role of SYSTEM_ROLES) {
      expect(role.permissions.every(isPermission)).toBe(true);
    }
    expect(isPermission('org.view')).toBe(true);
    expect(isPermission('toString')).toBe(false);
    expect(isPermission('payroll.finalize')).toBe(false);
  });
});

describe('team roles stay in their own area', () => {
  const perms = (key: string) => SYSTEM_ROLES.find((r) => r.key === key)!.permissions;
  const has = (key: string, prefix: string) => perms(key).some((p) => p.startsWith(prefix));

  it('keeps HR out of finance, payroll and operations', () => {
    for (const area of ['finance.', 'payroll.', 'expenses.', 'vendors.', 'procurement.', 'operations.']) {
      expect(has('hr_admin', area)).toBe(false);
    }
  });
  it('gives the finance team accounts and payroll but not HR records or operations', () => {
    expect(has('finance_team', 'finance.manage')).toBe(true);
    expect(has('finance_team', 'payroll.manage')).toBe(true);
    for (const area of ['employees.manage', 'employees.lifecycle', 'leave.', 'recruitment.', 'operations.']) {
      expect(has('finance_team', area)).toBe(false);
    }
  });
  it('gives operations managers structure and operations but not money or personal HR data', () => {
    expect(has('operations_manager', 'org.manage')).toBe(true);
    expect(has('operations_manager', 'operations.manage')).toBe(true);
    for (const area of ['finance.', 'payroll.', 'employees.sensitive', 'employees.manage', 'expenses.']) {
      expect(has('operations_manager', area)).toBe(false);
    }
  });
  it('gives organisation administrators every permission', () => {
    expect(new Set(perms('org_admin'))).toEqual(new Set(ALL_PERMISSIONS));
  });
});

describe('scopesFor', () => {
  const tenant = 't1';
  it('is ALL for owners and tenant-wide holders, else the held scopes', () => {
    expect(new PermissionSet(tenant, true).scopesFor('employees.view')).toBe('ALL');
    const wide = new PermissionSet(tenant, false, [
      { permissions: ['employees.view'], scope: { type: 'TENANT', id: tenant } },
    ]);
    expect(wide.scopesFor('employees.view')).toBe('ALL');
    const narrow = new PermissionSet(tenant, false, [
      { permissions: ['employees.view'], scope: { type: 'BRANCH', id: 'b1' } },
      { permissions: ['employees.view'], scope: { type: 'DEPARTMENT', id: 'd1' } },
      { permissions: ['org.view'], scope: { type: 'COMPANY', id: 'c1' } },
    ]);
    expect(narrow.scopesFor('employees.view')).toEqual([
      { type: 'BRANCH', id: 'b1' },
      { type: 'DEPARTMENT', id: 'd1' },
    ]);
    expect(narrow.scopesFor('employees.manage')).toEqual([]);
  });
});
