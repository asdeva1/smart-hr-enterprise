/**
 * Permission catalogue. Codes are `module.action`; roles store codes, the API enforces them.
 * Each phase adds the codes for its module here — the API refuses unknown codes in role definitions.
 */
export const PERMISSIONS = {
  'org.view': { module: 'organisation', label: 'View companies, branches and departments' },
  'org.manage': { module: 'organisation', label: 'Create and change companies, branches and departments' },
  'access.view': { module: 'access', label: 'View members, roles and assignments' },
  'access.manage': { module: 'access', label: 'Invite members and manage roles and assignments' },
  'settings.manage': { module: 'settings', label: 'Change organisation settings' },
  'master_data.manage': { module: 'settings', label: 'Maintain reference lists (designations, grades, …)' },
  'security.manage': { module: 'settings', label: 'Change organisation security policy' },
  'audit.view': { module: 'audit', label: 'View the audit log' },
  'approvals.view_all': { module: 'approvals', label: 'See every approval request in their scope' },
  'approvals.manage': { module: 'approvals', label: 'Configure approval policies' },
  'employees.view': { module: 'employees', label: 'View employee records in their part of the organisation' },
  'employees.manage': { module: 'employees', label: 'Add employees and change their records' },
  'employees.lifecycle': { module: 'employees', label: 'Record transfers, promotions, notice and exits' },
  'employees.sensitive.view': { module: 'employees', label: 'See identity documents and bank details' },
  'employees.sensitive.manage': { module: 'employees', label: 'Change identity documents and bank details' },
  'attendance.view': {
    module: 'attendance',
    label: 'See attendance for employees in their part of the organisation',
  },
  'attendance.manage': {
    module: 'attendance',
    label: 'Record clock-ins on someone’s behalf and assign shifts',
  },
  'attendance.configure': { module: 'attendance', label: 'Set up shifts and attendance rules' },
  'leave.view': {
    module: 'leave',
    label: 'See leave and balances for employees in their part of the organisation',
  },
  'leave.manage': {
    module: 'leave',
    label: 'Apply or cancel leave on someone’s behalf and adjust their balances',
  },
  'leave.configure': { module: 'leave', label: 'Set up leave types and holiday calendars' },
  'documents.view': {
    module: 'documents',
    label: 'See documents on employee records in their part of the organisation',
  },
  'documents.manage': {
    module: 'documents',
    label: 'Add, change and archive employee documents, make letters and send them for signature',
  },
  'documents.configure': { module: 'documents', label: 'Maintain letter templates' },
  'recruitment.view': {
    module: 'recruitment',
    label: 'See job openings, candidates and their progress in their part of the organisation',
  },
  'recruitment.manage': {
    module: 'recruitment',
    label:
      'Open positions, add candidates, move them through the pipeline, schedule interviews and make offers',
  },
  'payroll.view': {
    module: 'payroll',
    label: 'See salaries, payroll runs and payslips in their part of the organisation',
  },
  'payroll.manage': {
    module: 'payroll',
    label:
      'Set salaries, prepare payroll runs and send them for approval, and export bank and statutory files',
  },
  'payroll.configure': {
    module: 'payroll',
    label: 'Set up pay components, statutory registrations and professional tax',
  },
  'finance.view': { module: 'finance', label: 'See the chart of accounts, journals and financial reports' },
  'finance.manage': {
    module: 'finance',
    label: 'Write journals and send them for approval, and reverse posted ones',
  },
  'finance.configure': { module: 'finance', label: 'Maintain the chart of accounts and close the books' },
  'expenses.view': { module: 'expenses', label: 'See expense claims in their part of the organisation' },
  'expenses.manage': {
    module: 'expenses',
    label: 'Maintain expense categories and mark approved claims as paid',
  },
  'vendors.view': { module: 'procurement', label: 'See vendors' },
  'vendors.manage': { module: 'procurement', label: 'Add and change vendors' },
  'onboarding.manage': {
    module: 'recruitment',
    label: 'Maintain onboarding checklists and start onboarding for new joiners',
  },
} as const satisfies Record<string, { module: string; label: string }>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const PERMISSION_MODULES: Record<string, string> = {
  organisation: 'Organisation',
  access: 'People and access',
  settings: 'Settings',
  audit: 'Audit',
  approvals: 'Approvals',
  employees: 'Employees',
  attendance: 'Attendance',
  leave: 'Leave and holidays',
  documents: 'Documents',
  recruitment: 'Recruitment and onboarding',
  payroll: 'Payroll',
  finance: 'Finance and accounting',
  expenses: 'Expenses',
  procurement: 'Vendors and procurement',
};

export function isPermission(code: string): code is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, code);
}

export type ScopeKind = 'TENANT' | 'COMPANY' | 'BRANCH' | 'DEPARTMENT';

export interface ScopeRef {
  type: ScopeKind;
  id: string;
}

/** Roles every tenant starts with. System roles cannot be edited or deleted. */
export const SYSTEM_ROLES: { key: string; name: string; description: string; permissions: Permission[] }[] = [
  {
    key: 'org_admin',
    name: 'Organisation administrator',
    description: 'Manages organisation structure, people, roles, settings and security.',
    permissions: [...ALL_PERMISSIONS],
  },
  {
    key: 'access_admin',
    name: 'Access administrator',
    description: 'Invites members and assigns roles. Cannot change organisation structure.',
    permissions: ['org.view', 'access.view', 'access.manage', 'audit.view'],
  },
  {
    key: 'hr_admin',
    name: 'HR administrator',
    description:
      'Maintains employee records, their history and personal details, attendance and shifts, leave and holidays, documents and letters, recruitment and onboarding, and HR reference lists.',
    permissions: [
      'org.view',
      'master_data.manage',
      'employees.view',
      'employees.manage',
      'employees.lifecycle',
      'employees.sensitive.view',
      'employees.sensitive.manage',
      'attendance.view',
      'attendance.manage',
      'attendance.configure',
      'leave.view',
      'leave.manage',
      'leave.configure',
      'documents.view',
      'documents.manage',
      'documents.configure',
      'recruitment.view',
      'recruitment.manage',
      'onboarding.manage',
    ],
  },
  {
    key: 'payroll_admin',
    name: 'Payroll administrator',
    description:
      'Sets salaries, prepares monthly payroll and sends it for approval, and exports bank and statutory files. Sees bank details to pay people.',
    permissions: [
      'org.view',
      'employees.view',
      'employees.sensitive.view',
      'payroll.view',
      'payroll.manage',
      'payroll.configure',
    ],
  },
  {
    key: 'accountant',
    name: 'Accountant',
    description: 'Keeps the books: chart of accounts, journals, closing the books and financial reports.',
    permissions: [
      'org.view',
      'finance.view',
      'finance.manage',
      'finance.configure',
      'expenses.view',
      'expenses.manage',
      'vendors.view',
      'vendors.manage',
    ],
  },
  {
    key: 'auditor',
    name: 'Auditor',
    description: 'Read-only access to structure, access and the audit log.',
    permissions: [
      'org.view',
      'access.view',
      'audit.view',
      'approvals.view_all',
      'employees.view',
      'attendance.view',
      'leave.view',
      'documents.view',
      'recruitment.view',
      'finance.view',
      'expenses.view',
      'vendors.view',
    ],
  },
  {
    key: 'member',
    name: 'Member',
    description: 'Can see the organisation structure.',
    permissions: ['org.view'],
  },
];

/**
 * The permissions one member holds, each with the scopes it applies to.
 * Organisation owners hold every permission across the whole tenant.
 */
export class PermissionSet {
  private readonly grants = new Map<string, ScopeRef[]>();

  constructor(
    readonly tenantId: string,
    readonly isOwner: boolean,
    assignments: { permissions: readonly string[]; scope: ScopeRef }[] = [],
  ) {
    for (const assignment of assignments) {
      for (const code of assignment.permissions) {
        const scopes = this.grants.get(code) ?? [];
        scopes.push(assignment.scope);
        this.grants.set(code, scopes);
      }
    }
  }

  /** Codes held anywhere (any scope). Use for navigation and coarse route checks only. */
  codes(): Permission[] {
    return this.isOwner ? [...ALL_PERMISSIONS] : ALL_PERMISSIONS.filter((code) => this.grants.has(code));
  }

  hasAnywhere(code: Permission): boolean {
    return this.isOwner || this.grants.has(code);
  }

  /**
   * True when the permission is held at a scope that covers the target.
   * `targetScopes` lists every scope the target sits in: always the tenant, then its company,
   * branch, department and that department's ancestors, as applicable.
   */
  allows(code: Permission, targetScopes: readonly ScopeRef[]): boolean {
    if (this.isOwner) return true;
    const held = this.grants.get(code);
    if (!held) return false;
    return held.some((scope) =>
      scope.type === 'TENANT'
        ? scope.id === this.tenantId
        : targetScopes.some((target) => target.type === scope.type && target.id === scope.id),
    );
  }

  /**
   * Where a permission is held, for filtering lists: 'ALL' when tenant-wide (or owner), otherwise the
   * scopes. Department scopes cover their sub-departments; callers expand them.
   */
  scopesFor(code: Permission): 'ALL' | ScopeRef[] {
    if (this.isOwner) return 'ALL';
    const held = this.grants.get(code) ?? [];
    if (held.some((s) => s.type === 'TENANT' && s.id === this.tenantId)) return 'ALL';
    return held.filter((s) => s.type !== 'TENANT');
  }

  /** Tenant-wide holding, needed for actions that are not tied to one part of the organisation. */
  allowsTenantWide(code: Permission): boolean {
    return this.allows(code, [{ type: 'TENANT', id: this.tenantId }]);
  }
}
