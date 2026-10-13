import { describe, expect, it } from 'vitest';
import { roleAssignmentSchema } from './access.js';
import { createBranchSchema, createCompanySchema, createDepartmentSchema } from './org.js';

describe('createCompanySchema', () => {
  it('normalises codes and country/currency case', () => {
    const parsed = createCompanySchema.parse({
      code: 'acme-in',
      name: 'Acme India',
      country: 'in',
      baseCurrency: 'inr',
      timezone: 'Asia/Kolkata',
    });
    expect(parsed).toMatchObject({ code: 'ACME-IN', country: 'IN', baseCurrency: 'INR' });
  });

  it('rejects unknown time zones and malformed codes', () => {
    const result = createCompanySchema.safeParse({
      code: '-bad code',
      name: 'X',
      country: 'IND',
      baseCurrency: 'RUPEE',
      timezone: 'Mars/Olympus',
    });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['code', 'name', 'country', 'baseCurrency', 'timezone']));
  });
});

describe('createDepartmentSchema', () => {
  it('requires a company id', () => {
    expect(createDepartmentSchema.safeParse({ code: 'HR', name: 'Human resources' }).success).toBe(false);
  });
});

describe('roleAssignmentSchema', () => {
  const roleId = '01890a5d-ac96-774b-bcce-b302099a8057';
  it('needs a scope id except for tenant-wide assignments', () => {
    expect(roleAssignmentSchema.safeParse({ roleId, scopeType: 'TENANT' }).success).toBe(true);
    expect(roleAssignmentSchema.safeParse({ roleId, scopeType: 'COMPANY' }).success).toBe(false);
    expect(roleAssignmentSchema.safeParse({ roleId, scopeType: 'COMPANY', scopeId: roleId }).success).toBe(
      true,
    );
  });
});

describe('empty optional choices from forms', () => {
  const companyId = '01890a5d-ac96-774b-bcce-b302099a8057';
  it('treat an empty parent department as top level', () => {
    const parsed = createDepartmentSchema.parse({ companyId, parentId: '', code: 'ops', name: 'Operations' });
    expect(parsed.parentId).toBeNull();
  });

  it('treat an empty branch country and time zone as not set', () => {
    const parsed = createBranchSchema.parse({
      companyId,
      code: 'blr',
      name: 'Bengaluru',
      country: '',
      timezone: '',
    });
    expect(parsed).toMatchObject({ country: null, timezone: null });
  });

  it('still reject a malformed parent id', () => {
    expect(
      createDepartmentSchema.safeParse({ companyId, parentId: 'nope', code: 'ops', name: 'Ops' }).success,
    ).toBe(false);
  });
});
