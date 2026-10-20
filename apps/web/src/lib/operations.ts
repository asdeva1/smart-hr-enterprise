export type StageKind = 'OPEN' | 'DONE' | 'CANCELLED';
export type FieldType = 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'BOOLEAN';
export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type Level = 'none' | 'view' | 'contribute' | 'manage';

export const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
};
export const PRIORITY_TONE = {
  LOW: 'neutral',
  NORMAL: 'neutral',
  HIGH: 'warning',
  URGENT: 'danger',
} as const;
export const STAGE_KIND_LABEL: Record<StageKind, string> = {
  OPEN: 'Open work',
  DONE: 'Finished',
  CANCELLED: 'Dropped',
};
export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  TEXT: 'Text',
  NUMBER: 'Number',
  DATE: 'Date',
  SELECT: 'Choice',
  BOOLEAN: 'Yes / no',
};

export interface Template {
  key: string;
  name: string;
  description: string;
  stages: string[];
  fields: string[];
}

export interface Workspace {
  id: string;
  companyId: string;
  code: string;
  name: string;
  description: string | null;
  template: string | null;
  prefix: string;
  status: 'ACTIVE' | 'ARCHIVED';
  level: Level;
  openItems: number;
}

export interface Stage {
  id: string;
  key: string;
  label: string;
  kind: StageKind;
  items?: number;
}

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[];
}

export interface WorkspaceDetail extends Workspace {
  stages: Stage[];
  fields: Field[];
}

export type Values = Record<string, string | number | boolean | null>;

export interface Item {
  id: string;
  workspaceId: string;
  workspace: { name: string; code: string };
  ref: string;
  number: number;
  title: string;
  description: string | null;
  stage: Stage;
  priority: Priority;
  assignee: { id: string; name: string } | null;
  dueDate: string | null;
  overdue: boolean;
  values: Values;
  createdAt: string;
  completedAt: string | null;
}

export interface ItemEvent {
  id: string;
  kind: 'CREATED' | 'EDITED' | 'STAGE' | 'ASSIGNED' | 'COMMENT';
  actor: string;
  body: string | null;
  data: { from?: string; to?: string | null } | null;
  at: string;
}

export interface ItemDetail extends Item {
  canWork: boolean;
  canAssign: boolean;
  stages: Stage[];
  fields: Field[];
  events: ItemEvent[];
}

export const opsKeys = {
  all: ['operations'] as const,
  templates: ['operations', 'templates'] as const,
  workspaces: ['operations', 'workspaces'] as const,
  workspace: (id: string) => ['operations', 'workspace', id] as const,
  items: (id: string, stageId: string, open: string) => ['operations', 'items', id, stageId, open] as const,
  item: (id: string) => ['operations', 'item', id] as const,
  mine: ['operations', 'mine'] as const,
};
