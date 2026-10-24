export type RenewalStage = 'OK' | 'SOON' | 'DUE' | 'GRACE' | 'EXPIRED' | 'REVOKED' | 'NOT_YET_VALID';

export interface IssuedLicenceRow {
  id: string;
  licenceId: string;
  customerName: string;
  planCode: string;
  planName: string;
  supportLevel: string;
  issuedAt: string;
  notBefore: string;
  expiresAt: string;
  graceDays: number;
  signatureChecked: boolean;
  notes: string | null;
  status: 'ACTIVE' | 'REVOKED';
  revokedAt: string | null;
  revokedReason: string | null;
  renewedById: string | null;
  recordedBy: string | null;
  stage: RenewalStage;
  daysLeft: number;
}

export interface RenewalRow {
  tenantId: string;
  organisation: string;
  plan: string;
  kind: 'TRIAL' | 'SUBSCRIPTION';
  endsAt: string;
  stage: RenewalStage;
  daysLeft: number;
}

export interface LicenceRegister {
  licences: IssuedLicenceRow[];
  renewals: RenewalRow[];
  summary: {
    licencesDue: number;
    licencesLapsed: number;
    subscriptionsDue: number;
    subscriptionsLapsed: number;
  };
}

export const REGISTER_KEY = ['platform', 'licence-register'] as const;

export const STAGE: Record<
  RenewalStage,
  { tone: 'success' | 'warning' | 'danger' | 'neutral'; text: string }
> = {
  OK: { tone: 'success', text: 'In date' },
  SOON: { tone: 'warning', text: 'Ends within 60 days' },
  DUE: { tone: 'warning', text: 'Renew now' },
  GRACE: { tone: 'danger', text: 'In grace period' },
  EXPIRED: { tone: 'danger', text: 'Expired' },
  REVOKED: { tone: 'neutral', text: 'Revoked' },
  NOT_YET_VALID: { tone: 'neutral', text: 'Not valid yet' },
};

export function daysText(days: number): string {
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? '' : 's'} ago`;
  if (days === 0) return 'today';
  return `in ${days} day${days === 1 ? '' : 's'}`;
}
