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
