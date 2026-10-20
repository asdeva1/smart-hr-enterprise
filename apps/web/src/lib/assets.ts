import { apiFetch } from './api';

export type AssetStatus = 'IN_STOCK' | 'ASSIGNED' | 'UNDER_REPAIR' | 'RETIRED';

export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  IN_STOCK: 'In stock',
  ASSIGNED: 'Assigned',
  UNDER_REPAIR: 'Under repair',
  RETIRED: 'Retired',
};
export const ASSET_STATUS_TONE = {
  IN_STOCK: 'success',
  ASSIGNED: 'info',
  UNDER_REPAIR: 'warning',
  RETIRED: 'neutral',
} as const;

export interface Depreciation {
  monthsElapsed: number;
  monthlyCharge: number;
  accumulated: number;
  bookValue: number;
  fullyDepreciated: boolean;
}

export interface Asset {
  id: string;
  companyId: string;
  tag: string;
  name: string;
  category: string;
  serialNumber: string | null;
  vendor: { id: string; name: string } | null;
  purchaseDate: string;
  purchaseCost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  currency: string;
  status: AssetStatus;
  notes: string | null;
  retiredOn: string | null;
  retireReason: string | null;
  depreciation: Depreciation;
}

export interface AssetRow extends Asset {
  holder: { id: string; name: string } | null;
}

export interface AssetDetail extends Asset {
  canManage: boolean;
  history: {
    id: string;
    employee: { id: string; code: string; name: string };
    assignedOn: string;
    returnedOn: string | null;
    conditionOut: string | null;
    conditionIn: string | null;
  }[];
}

export interface MyAsset {
  assignmentId: string;
  assignedOn: string;
  conditionOut: string | null;
  asset: { id: string; tag: string; name: string; category: string };
}

export const assetKeys = {
  all: ['assets'] as const,
  list: (q: string, status: string) => ['assets', 'list', q, status] as const,
  detail: (id: string) => ['assets', 'detail', id] as const,
  mine: ['assets', 'mine'] as const,
};

export const fetchPeople = (search: string) =>
  apiFetch<{ id: string; code: string; name: string }[]>(
    `/v1/assets/people?search=${encodeURIComponent(search)}`,
  );
