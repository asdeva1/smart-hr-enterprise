'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

export type SettingInput =
  | { type: 'select'; options: { value: string | number; label: string }[] }
  | { type: 'text'; placeholder?: string }
  | { type: 'timezone' };

export interface SettingView {
  key: string;
  group: 'Locale' | 'Finance' | 'People';
  label: string;
  description: string;
  input: SettingInput;
  value: string | number;
  default: string | number;
  isDefault: boolean;
  updatedAt: string | null;
}

export interface MasterDataListView {
  list: string;
  label: string;
  description: string;
  usedBy: string;
  active: number;
  archived: number;
  suggestionsAvailable: number;
}

export interface LookupValue {
  id: string;
  list: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  status: 'ACTIVE' | 'ARCHIVED';
  updatedAt: string;
}

export const configKeys = {
  settings: ['configuration'] as const,
  lists: ['master-data'] as const,
  values: (list: string, includeArchived: boolean) => ['master-data', list, includeArchived] as const,
};

export const useConfiguration = () =>
  useQuery({
    queryKey: configKeys.settings,
    queryFn: () => apiFetch<SettingView[]>('/v1/tenant/configuration'),
  });

export const useMasterDataLists = () =>
  useQuery({ queryKey: configKeys.lists, queryFn: () => apiFetch<MasterDataListView[]>('/v1/master-data') });

/** Active values of one list, for pickers in other modules. */
export const useLookupValues = (list: string, includeArchived = false) =>
  useQuery({
    queryKey: configKeys.values(list, includeArchived),
    queryFn: () =>
      apiFetch<LookupValue[]>(`/v1/master-data/${list}${includeArchived ? '?includeArchived=true' : ''}`),
  });
