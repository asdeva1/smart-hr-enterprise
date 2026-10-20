'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import {
  ItemDialog,
  MovementDialog,
  useItems,
  useWarehouses,
  WarehouseDialog,
  type MovementMode,
} from '@/components/inventory/dialogs';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import {
  inventoryKeys,
  MOVEMENT_LABEL,
  type InventoryItem,
  type Movement,
  type StockRow,
  type Warehouse,
} from '@/lib/inventory';
import { can, hasFeature } from '@/lib/permissions';

type Tab = 'stock' | 'movements' | 'items' | 'warehouses';

export default function InventoryPage() {
  return (
    <RequireSession permission="inventory.view">
      {(session) => (
        <AppShell active="Inventory" session={session}>
          {hasFeature(session, 'inventory') ? (
            <Inventory session={session} />
          ) : (
            <Alert tone="info">Your organisation’s plan doesn’t include inventory.</Alert>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}

function Inventory({ session }: { session: SessionView }) {
  const manage = can(session, 'inventory.manage');
  const [tab, setTab] = useState<Tab>('stock');
  const [movement, setMovement] = useState<MovementMode | null>(null);
  return (
    <>
      <PageHeader
        title="Inventory"
        description="What is in stock and where. Every change is recorded and stock can never go below zero."
        actions={
          manage ? (
            <>
              <Button onClick={() => setMovement('receipt')}>Receive</Button>
              <Button variant="outline" onClick={() => setMovement('issue')}>
                Issue
              </Button>
              <Button variant="outline" onClick={() => setMovement('transfer')}>
                Move
              </Button>
              <Button variant="outline" onClick={() => setMovement('adjustment')}>
                Adjust
              </Button>
            </>
          ) : null
        }
      />
      <Tabs
        label="Inventory"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'stock', label: 'Stock' },
          { value: 'movements', label: 'History' },
          { value: 'items', label: 'Items' },
          { value: 'warehouses', label: 'Warehouses' },
        ]}
      />
      {tab === 'stock' && <Stock />}
      {tab === 'movements' && <Movements />}
      {tab === 'items' && <Items manage={manage} />}
      {tab === 'warehouses' && <Warehouses manage={manage} />}
      {movement && <MovementDialog mode={movement} onClose={() => setMovement(null)} />}
    </>
  );
}

function Stock() {
  const [lowOnly, setLowOnly] = useState(false);
  const stock = useQuery({
    queryKey: inventoryKeys.stock(lowOnly),
    queryFn: () => apiFetch<StockRow[]>(`/v1/inventory/stock${lowOnly ? '?lowOnly=true' : ''}`),
  });
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
        Only items at or below their reorder level
      </label>
      {stock.isPending ? (
        <Loading />
      ) : stock.isError ? (
        <Alert tone="error">{errorMessage(stock.error)}</Alert>
      ) : stock.data.length === 0 ? (
        <EmptyState title="No stock">
          {lowOnly ? 'Nothing is running low.' : 'Receive stock to see it here.'}
        </EmptyState>
      ) : (
        <Table label="Stock on hand">
          <thead>
            <tr>
              <Th>SKU</Th>
              <Th>Item</Th>
              <Th>Warehouse</Th>
              <Th className="text-right">On hand</Th>
              <Th className="text-right">Value</Th>
              <Th>Level</Th>
            </tr>
          </thead>
          <tbody>
            {stock.data.map((r) => (
              <tr key={`${r.item.id}-${r.warehouse.id}`}>
                <Td>{r.item.sku}</Td>
                <Td>{r.item.name}</Td>
                <Td>{r.warehouse.name}</Td>
                <Td className="text-right tabular-nums">
                  {r.onHand} {r.item.unit}
                </Td>
                <Td className="text-right tabular-nums">{r.value.toFixed(2)}</Td>
                <Td>{r.low ? <Badge tone="warning">Reorder</Badge> : <Badge tone="success">OK</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

function Movements() {
  const moves = useQuery({
    queryKey: inventoryKeys.movements,
    queryFn: () => apiFetch<Movement[]>('/v1/inventory/movements?limit=200'),
  });
  if (moves.isPending) return <Loading />;
  if (moves.isError) return <Alert tone="error">{errorMessage(moves.error)}</Alert>;
  if (moves.data.length === 0) return <EmptyState title="Nothing recorded yet" />;
  return (
    <Table label="Stock history">
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>What</Th>
          <Th>Item</Th>
          <Th>Warehouse</Th>
          <Th className="text-right">Quantity</Th>
          <Th>Reference</Th>
        </tr>
      </thead>
      <tbody>
        {moves.data.map((m) => (
          <tr key={m.id}>
            <Td className="whitespace-nowrap">{m.occurredOn}</Td>
            <Td>{MOVEMENT_LABEL[m.kind]}</Td>
            <Td>
              {m.item.sku} · {m.item.name}
            </Td>
            <Td>{m.warehouse.code}</Td>
            <Td className="text-right tabular-nums">{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</Td>
            <Td>{m.reference ?? m.note ?? '—'}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Items({ manage }: { manage: boolean }) {
  const items = useItems();
  const [editing, setEditing] = useState<InventoryItem | 'new' | null>(null);
  return (
    <>
      {manage && (
        <div>
          <Button variant="outline" onClick={() => setEditing('new')}>
            Add item
          </Button>
        </div>
      )}
      {items.isPending ? (
        <Loading />
      ) : items.isError ? (
        <Alert tone="error">{errorMessage(items.error)}</Alert>
      ) : items.data.length === 0 ? (
        <EmptyState title="No items yet">Add what you stock.</EmptyState>
      ) : (
        <Table label="Items">
          <thead>
            <tr>
              <Th>SKU</Th>
              <Th>Name</Th>
              <Th>Unit</Th>
              <Th className="text-right">Reorder at</Th>
              <Th className="text-right">Value per unit</Th>
              <Th>Status</Th>
              {manage && (
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.data.map((i) => (
              <tr key={i.id}>
                <Td>{i.sku}</Td>
                <Td>{i.name}</Td>
                <Td>{i.unit}</Td>
                <Td className="text-right tabular-nums">{i.reorderLevel ?? '—'}</Td>
                <Td className="text-right tabular-nums">{i.standardCost.toFixed(2)}</Td>
                <Td>
                  <Badge tone={i.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {i.status === 'ACTIVE' ? 'Active' : 'Archived'}
                  </Badge>
                </Td>
                {manage && (
                  <Td>
                    <Button variant="outline" onClick={() => setEditing(i)}>
                      Edit
                    </Button>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && (
        <ItemDialog item={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function Warehouses({ manage }: { manage: boolean }) {
  const warehouses = useWarehouses();
  const [editing, setEditing] = useState<Warehouse | 'new' | null>(null);
  return (
    <>
      {manage && (
        <div>
          <Button variant="outline" onClick={() => setEditing('new')}>
            Add warehouse
          </Button>
        </div>
      )}
      {warehouses.isPending ? (
        <Loading />
      ) : warehouses.isError ? (
        <Alert tone="error">{errorMessage(warehouses.error)}</Alert>
      ) : warehouses.data.length === 0 ? (
        <EmptyState title="No warehouses yet">Add the places you keep stock.</EmptyState>
      ) : (
        <Table label="Warehouses">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Address</Th>
              <Th>Status</Th>
              {manage && (
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              )}
            </tr>
          </thead>
          <tbody>
            {warehouses.data.map((w) => (
              <tr key={w.id}>
                <Td>{w.code}</Td>
                <Td>{w.name}</Td>
                <Td>{w.address ?? '—'}</Td>
                <Td>
                  <Badge tone={w.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {w.status === 'ACTIVE' ? 'Active' : 'Archived'}
                  </Badge>
                </Td>
                {manage && (
                  <Td>
                    <Button variant="outline" onClick={() => setEditing(w)}>
                      Edit
                    </Button>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && (
        <WarehouseDialog
          warehouse={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
