export interface Warehouse {
  id: string;
  companyId: string;
  code: string;
  name: string;
  address: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  unit: string;
  category: string | null;
  reorderLevel: number | null;
  standardCost: number;
  notes: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface StockRow {
  item: { id: string; sku: string; name: string; unit: string };
  warehouse: { id: string; code: string; name: string };
  onHand: number;
  reorderLevel: number | null;
  low: boolean;
  value: number;
}

export type MovementKind = 'RECEIPT' | 'ISSUE' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'ADJUSTMENT';

export const MOVEMENT_LABEL: Record<MovementKind, string> = {
  RECEIPT: 'Received',
  ISSUE: 'Issued',
  TRANSFER_OUT: 'Moved out',
  TRANSFER_IN: 'Moved in',
  ADJUSTMENT: 'Counted',
};

export interface Movement {
  id: string;
  kind: MovementKind;
  item: { id: string; sku: string; name: string };
  warehouse: { id: string; code: string };
  quantity: number;
  unitCost: number | null;
  occurredOn: string;
  reference: string | null;
  note: string | null;
  transferId: string | null;
  createdAt: string;
}

export const inventoryKeys = {
  all: ['inventory'] as const,
  warehouses: ['inventory', 'warehouses'] as const,
  items: ['inventory', 'items'] as const,
  stock: (lowOnly: boolean) => ['inventory', 'stock', lowOnly] as const,
  movements: ['inventory', 'movements'] as const,
};
