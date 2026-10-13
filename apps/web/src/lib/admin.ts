'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiError, apiFetch } from './api';

export type RecordStatus = 'ACTIVE' | 'ARCHIVED';
export type ScopeType = 'TENANT' | 'COMPANY' | 'BRANCH' | 'DEPARTMENT';

export interface Company {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  country: string;
  baseCurrency: string;
  timezone: string;
  status: RecordStatus;
  updatedAt: string;
}

export interface Branch {
  id: string;
  companyId: string;
  code: string;
  name: string;
  city: string | null;
  country: string | null;
  timezone: string | null;
  status: RecordStatus;
  updatedAt: string;
}

export interface Department {
  id: string;
  companyId: string;
  parentId: string | null;
  code: string;
  name: string;
  status: RecordStatus;
  updatedAt: string;
}

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  assignmentCount: number;
  updatedAt: string;
}

export interface PermissionDef {
  code: string;
  module: string;
  moduleLabel: string;
  label: string;
}

export interface Assignment {
  id: string;
  roleId: string;
  roleName: string;
  scopeType: ScopeType;
  scopeId: string;
  scopeName: string | null;
}

export interface Member {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string;
  status: 'ACTIVE' | 'SUSPENDED';
  isTenantAdmin: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  invitationPending: boolean;
  joinedAt: string;
  assignments: Assignment[];
}

export interface AuditEvent {
  id: string;
  occurredAt: string;
  action: string;
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
  actorUserId: string | null;
  targetType: string | null;
  targetId: string | null;
  ipAddress: string | null;
  metadata: Record<string, unknown>;
  actor: { displayName: string; email: string | null } | null;
}

export const adminKeys = {
  companies: ['org', 'companies'] as const,
  branches: ['org', 'branches'] as const,
  departments: ['org', 'departments'] as const,
  roles: ['admin', 'roles'] as const,
  permissions: ['admin', 'permissions'] as const,
  members: (search: string, page: number) => ['admin', 'members', search, page] as const,
  member: (id: string) => ['admin', 'member', id] as const,
  security: ['admin', 'security'] as const,
  audit: (filters: object) => ['admin', 'audit', filters] as const,
};

export const useCompanies = () =>
  useQuery({ queryKey: adminKeys.companies, queryFn: () => apiFetch<Company[]>('/v1/org/companies') });
export const useBranches = () =>
  useQuery({ queryKey: adminKeys.branches, queryFn: () => apiFetch<Branch[]>('/v1/org/branches') });
export const useDepartments = () =>
  useQuery({ queryKey: adminKeys.departments, queryFn: () => apiFetch<Department[]>('/v1/org/departments') });
export const useRoles = () =>
  useQuery({ queryKey: adminKeys.roles, queryFn: () => apiFetch<Role[]>('/v1/admin/roles') });
export const usePermissionCatalogue = () =>
  useQuery({
    queryKey: adminKeys.permissions,
    queryFn: () => apiFetch<PermissionDef[]>('/v1/admin/permissions'),
    staleTime: Infinity,
  });

/** A safe message for any failed request. */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.detail : 'We couldn’t reach Smart HR. Please try again.';
}

/** Copies field errors from an API problem onto a form; returns false when there were none. */
export function applyFieldErrors(
  error: unknown,
  setError: (field: never, error: { message: string }) => void,
): boolean {
  if (!(error instanceof ApiError) || error.fieldErrors.length === 0) return false;
  for (const fieldError of error.fieldErrors) {
    setError(fieldError.path as never, { message: fieldError.message });
  }
  return true;
}

export function scopeLabel(type: ScopeType): string {
  return { TENANT: 'Whole organisation', COMPANY: 'Company', BRANCH: 'Branch', DEPARTMENT: 'Department' }[
    type
  ];
}

export function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['Asia/Kolkata', 'UTC'];
  }
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}
