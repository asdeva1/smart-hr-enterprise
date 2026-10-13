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
} as const satisfies Record<string, { module: string; label: string }>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const PERMISSION_MODULES: Record<string, string> = {
  organisation: 'Organisation',
  access: 'People and access',
  settings: 'Settings',
  audit: 'Audit',
  approvals: 'Approvals',
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
    key: 'auditor',
    name: 'Auditor',
    description: 'Read-only access to structure, access and the audit log.',
    permissions: ['org.view', 'access.view', 'audit.view', 'approvals.view_all'],
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

  /** Tenant-wide holding, needed for actions that are not tied to one part of the organisation. */
  allowsTenantWide(code: Permission): boolean {
    return this.allows(code, [{ type: 'TENANT', id: this.tenantId }]);
  }
}
