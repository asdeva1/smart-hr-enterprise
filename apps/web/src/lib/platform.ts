'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

export interface TenantOverview {
  tenant: {
    id: string;
    slug: string;
    name: string;
    status: 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDING' | 'ARCHIVED';
    requireMfa: boolean;
    brandName: string | null;
    offboardingAt: string | null;
    archivedAt: string | null;
    createdAt: string;
  };
  members: Partial<Record<'ACTIVE' | 'SUSPENDED', number>>;
  owners: { email: string; displayName: string; status: string }[];
  companies: number;
}

export interface Operator {
  id: string;
  email: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  mfaEnabledAt: string | null;
  lastLoginAt: string | null;
}

export const platformKeys = {
  overview: (id: string) => ['platform', 'tenants', id, 'overview'] as const,
  operators: ['platform', 'operators'] as const,
};

export const useTenantOverview = (id: string) =>
  useQuery({
    queryKey: platformKeys.overview(id),
    queryFn: () => apiFetch<TenantOverview>(`/v1/platform/tenants/${id}`),
  });

export const useOperators = () =>
  useQuery({
    queryKey: platformKeys.operators,
    queryFn: () => apiFetch<Operator[]>('/v1/platform/operators'),
  });

/** A starting address for a new organisation, from its name. The operator can change it. */
export function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}
