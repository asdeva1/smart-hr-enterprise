'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch, type SubscriptionEffectiveStatus } from './api';

export type BillingPeriod = 'MONTHLY' | 'ANNUAL';
export type PricingModel = 'PER_USER' | 'PER_EMPLOYEE' | 'FLAT';
export type StoredSubscriptionStatus =
  'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'SUSPENDED' | 'EXPIRED';

export interface Entitlements {
  plan: { code: string; name: string; version: number } | null;
  status: SubscriptionEffectiveStatus;
  access: 'FULL' | 'READ_ONLY' | 'NONE';
  features: string[];
  limits: Record<string, number | null>;
  trialEndsAt: string | null;
  periodEndsAt: string | null;
  graceEndsAt: string | null;
}

export interface TenantPlanView {
  /** In-house installations take everything from the licence and have no subscription. */
  source: 'subscription' | 'licence';
  entitlements: Entitlements;
  licence: {
    customer: string;
    supportLevel: string;
    expiresAt: string;
    graceDays: number;
    verified: boolean;
  } | null;
  subscription: {
    storedStatus: StoredSubscriptionStatus;
    billingPeriod: BillingPeriod;
    currency: string;
    trialEndsAt: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelledAt: string | null;
    supportLevel: string;
    deploymentModels: string[];
    addons: { code: string; name: string; kind: string; quantity: number }[];
  } | null;
  features: { code: string; module: string; label: string; included: boolean }[];
  limits: { code: string; label: string; unit: string; limit: number | null; used: number | null }[];
}

export interface PlanPrice {
  id: string;
  currency: string;
  billingPeriod: BillingPeriod;
  pricingModel: PricingModel;
  amount: string;
}

export interface PlanVersion {
  id: string;
  planId: string;
  version: number;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  features: string[];
  limits: Record<string, number | null>;
  trialDays: number;
  graceDays: number;
  supportLevel: string;
  deploymentModels: string[];
  notes: string | null;
  publishedAt: string | null;
  retiredAt: string | null;
  prices: PlanPrice[];
  _count: { subscriptions: number };
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  status: 'ACTIVE' | 'ARCHIVED';
  versions: PlanVersion[];
}

export interface Addon {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kind: 'FEATURE' | 'CAPACITY' | 'SERVICE';
  features: string[];
  limits: Record<string, number | null>;
  status: 'ACTIVE' | 'ARCHIVED';
  prices: PlanPrice[];
  _count?: { subscriptions: number };
}

export interface PlatformTenantRow {
  id: string;
  slug: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDING' | 'ARCHIVED';
  createdAt: string;
  subscription: {
    status: StoredSubscriptionStatus;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    planVersion: { version: number; plan: { code: string; name: string } };
  } | null;
}

export interface TenantSubscriptionDetail {
  tenant: { id: string; name: string };
  subscription: {
    id: string;
    status: StoredSubscriptionStatus;
    billingPeriod: BillingPeriod;
    currency: string;
    trialEndsAt: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    graceEndsAt: string | null;
    cancelledAt: string | null;
    planVersionId: string;
    planVersion: PlanVersion & { plan: { id: string; code: string; name: string } };
    addons: {
      id: string;
      quantity: number;
      addon: { id: string; code: string; name: string; kind: string };
    }[];
  } | null;
  overrides: {
    id: string;
    kind: 'FEATURE' | 'LIMIT';
    key: string;
    enabled: boolean | null;
    value: number | null;
    reason: string;
    expiresAt: string | null;
    createdAt: string;
    revokedAt: string | null;
  }[];
  events: {
    id: string;
    action: string;
    fromStatus: StoredSubscriptionStatus | null;
    toStatus: StoredSubscriptionStatus | null;
    details: Record<string, unknown>;
    occurredAt: string;
  }[];
  entitlements: Entitlements;
  usage: Record<string, number>;
}

export const planKeys = {
  tenant: ['tenant', 'plan'] as const,
  plans: ['platform', 'plans'] as const,
  addons: ['platform', 'addons'] as const,
  tenants: ['platform', 'tenants'] as const,
  subscription: (tenantId: string) => ['platform', 'tenants', tenantId, 'subscription'] as const,
};

export const useTenantPlan = () =>
  useQuery({ queryKey: planKeys.tenant, queryFn: () => apiFetch<TenantPlanView>('/v1/tenant/plan') });

export const usePlans = () =>
  useQuery({ queryKey: planKeys.plans, queryFn: () => apiFetch<Plan[]>('/v1/platform/plans') });

export const useAddons = () =>
  useQuery({ queryKey: planKeys.addons, queryFn: () => apiFetch<Addon[]>('/v1/platform/addons') });

export const usePlatformTenants = () =>
  useQuery({
    queryKey: planKeys.tenants,
    queryFn: () => apiFetch<PlatformTenantRow[]>('/v1/platform/tenants'),
  });

export const useTenantSubscription = (tenantId: string) =>
  useQuery({
    queryKey: planKeys.subscription(tenantId),
    queryFn: () => apiFetch<TenantSubscriptionDetail>(`/v1/platform/tenants/${tenantId}/subscription`),
  });

export const STATUS_LABEL: Record<SubscriptionEffectiveStatus, string> = {
  NONE: 'No subscription',
  TRIAL: 'Trial',
  ACTIVE: 'Active',
  PAST_DUE: 'Payment overdue',
  GRACE: 'Grace period',
  EXPIRED: 'Ended — read-only',
  SUSPENDED: 'Suspended — read-only',
};

export const STATUS_TONE: Record<
  SubscriptionEffectiveStatus,
  'success' | 'warning' | 'danger' | 'info' | 'neutral'
> = {
  NONE: 'neutral',
  TRIAL: 'info',
  ACTIVE: 'success',
  PAST_DUE: 'warning',
  GRACE: 'warning',
  EXPIRED: 'danger',
  SUSPENDED: 'danger',
};

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatLimit(limit: number | null, unit: string): string {
  return limit === null ? 'Unlimited' : `${limit.toLocaleString('en-IN')} ${unit}`;
}
