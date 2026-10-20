/**
 * Inventory through the real API and database: items and warehouses, stock in, out, between warehouses and by
 * count, the append-only ledger, no negative stock (also under concurrent issues, by the database itself),
 * low-stock flags, who can see and change what, and the plan gate.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import { Browser, Fixtures, ownerClient, startApp, testEnv } from './helpers.js';

const db = ownerClient();
const fx = new Fixtures(db);
let app: NestExpressApplication;
let tenantId: string;
let owner: Browser;
let acme: string;
let other: string;

let keeper: Browser;
let viewer: Browser;
let outsider: Browser;
let main: string;
let annex: string;
let boxes: string;
let cables: string;

async function member(
  label: string,
  permissions: string[],
  scope: { type: 'TENANT' | 'COMPANY'; id: string },
) {
  const user = await fx.user(label);
  const m = await fx.member(tenantId, user.id);
  if (permissions.length)
    await fx.assign(tenantId, m.id, await fx.customRole(tenantId, label, permissions), scope);
  const b = new Browser(app);
  expect((await b.login(user.email)).status).toBe(200);
  return b;
}

const onHand = async (itemId: string, warehouseId: string) => {
  const res = await keeper.get(`/v1/inventory/stock?itemId=${itemId}&warehouseId=${warehouseId}`);
  return (res.body as { onHand: number }[])[0]?.onHand ?? 0;
};

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  const tenant = await fx.tenant('Inventory');
  tenantId = tenant.id;
  const ownerUser = await fx.user('inv-owner');
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  acme = (await fx.company(tenantId, 'ACME')).id;
  other = (await fx.company(tenantId, 'OTHER')).id;

  keeper = await member('inv-keeper', ['inventory.view', 'inventory.manage'], {
    type: 'TENANT',
    id: tenantId,
  });
  viewer = await member('inv-viewer', ['inventory.view'], { type: 'TENANT', id: tenantId });
  outsider = await member('inv-outsider', ['inventory.view', 'inventory.manage'], {
    type: 'COMPANY',
    id: other,
  });

  const w = async (code: string) => {
    const res = await keeper.send('post', '/v1/inventory/warehouses', {
      companyId: acme,
      code,
      name: `WH ${code}`,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };
  main = await w('MAIN');
  annex = await w('ANNEX');
  const item = async (body: Record<string, unknown>) => {
    const res = await keeper.send('post', '/v1/inventory/items', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };
  boxes = await item({ sku: 'box-l', name: 'Large box', unit: 'pcs', reorderLevel: 20, standardCost: 12.5 });
  cables = await item({ sku: 'CAB-1', name: 'Cable', unit: 'pcs' });
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await db.$disconnect();
});

describe('items and warehouses', () => {
  it('are kept by inventory.manage, with unique codes', async () => {
    expect(
      (await viewer.send('post', '/v1/inventory/items', { sku: 'NEW-1', name: 'x1', unit: 'pcs' })).status,
    ).toBe(403);
    expect(
      (await keeper.send('post', '/v1/inventory/items', { sku: 'BOX-L', name: 'Again', unit: 'pcs' })).status,
    ).toBe(400);
    expect(
      (await keeper.send('post', '/v1/inventory/warehouses', { companyId: acme, code: 'MAIN', name: 'Dup' }))
        .status,
    ).toBe(400);
    const items = await viewer.get('/v1/inventory/items');
    expect((items.body as { sku: string }[]).map((i) => i.sku)).toEqual(['BOX-L', 'CAB-1']);
  });

  it('limit warehouse changes to the company the permission covers', async () => {
    expect(
      (
        await outsider.send('post', '/v1/inventory/warehouses', {
          companyId: acme,
          code: 'NOPE',
          name: 'Nope',
        })
      ).status,
    ).toBe(403);
    expect((await outsider.get('/v1/inventory/warehouses')).body).toHaveLength(0);
    // Items are shared across companies, so a company-scoped manager can't change them.
    expect(
      (await outsider.send('post', '/v1/inventory/items', { sku: 'OUT-1', name: 'Out', unit: 'pcs' })).status,
    ).toBe(403);
  });
});

describe('stock', () => {
  it('goes in on receipt and shows on hand with its value and low-stock flag', async () => {
    const res = await keeper.send('post', '/v1/inventory/receipts', {
      itemId: boxes,
      warehouseId: main,
      quantity: 15,
      unitCost: 12.5,
      reference: 'GRN-000001',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.onHand).toBe(15);
    const stock = (await viewer.get('/v1/inventory/stock')).body as {
      item: { sku: string };
      onHand: number;
      low: boolean;
      value: number;
    }[];
    expect(stock).toHaveLength(1);
    expect(stock[0]).toMatchObject({ onHand: 15, low: true, value: 187.5 });
    expect((await viewer.get('/v1/inventory/stock?lowOnly=true')).body).toHaveLength(1);
    await keeper.send('post', '/v1/inventory/receipts', { itemId: boxes, warehouseId: main, quantity: 10 });
    expect((await viewer.get('/v1/inventory/stock?lowOnly=true')).body).toHaveLength(0);
  });

  it('comes out on issue, never below zero', async () => {
    const ok = await keeper.send('post', '/v1/inventory/issues', {
      itemId: boxes,
      warehouseId: main,
      quantity: 5.5,
    });
    expect(ok.body.onHand).toBe(19.5);
    const over = await keeper.send('post', '/v1/inventory/issues', {
      itemId: boxes,
      warehouseId: main,
      quantity: 100,
    });
    expect(over.status).toBe(409);
    expect(over.body.code).toBe('INSUFFICIENT_STOCK');
    expect(await onHand(boxes, main)).toBe(19.5);
  });

  it('moves between warehouses as two linked entries', async () => {
    const res = await keeper.send('post', '/v1/inventory/transfers', {
      itemId: boxes,
      fromWarehouseId: main,
      toWarehouseId: annex,
      quantity: 4.5,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.from).toBe(15);
    expect(res.body.to).toBe(4.5);
    const moves = (await keeper.get(`/v1/inventory/movements?itemId=${boxes}`)).body as {
      kind: string;
      transferId: string | null;
    }[];
    expect(
      moves
        .filter((m) => m.transferId === res.body.transferId)
        .map((m) => m.kind)
        .sort(),
    ).toEqual(['TRANSFER_IN', 'TRANSFER_OUT']);
    expect(
      (
        await keeper.send('post', '/v1/inventory/transfers', {
          itemId: boxes,
          fromWarehouseId: main,
          toWarehouseId: main,
          quantity: 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await keeper.send('post', '/v1/inventory/transfers', {
          itemId: boxes,
          fromWarehouseId: annex,
          toWarehouseId: main,
          quantity: 99,
        })
      ).status,
    ).toBe(409);
  });

  it('can be corrected by a count, with a reason', async () => {
    expect(
      (
        await keeper.send('post', '/v1/inventory/adjustments', {
          itemId: boxes,
          warehouseId: main,
          quantity: -2,
        })
      ).status,
    ).toBe(400);
    const down = await keeper.send('post', '/v1/inventory/adjustments', {
      itemId: boxes,
      warehouseId: main,
      quantity: -2,
      note: 'Damaged in count',
    });
    expect(down.body.onHand).toBe(13);
    const tooFar = await keeper.send('post', '/v1/inventory/adjustments', {
      itemId: boxes,
      warehouseId: main,
      quantity: -50,
      note: 'Count error',
    });
    expect(tooFar.status).toBe(409);
  });

  it('only the right people can move it', async () => {
    expect(
      (await viewer.send('post', '/v1/inventory/receipts', { itemId: boxes, warehouseId: main, quantity: 1 }))
        .status,
    ).toBe(403);
    expect(
      (
        await outsider.send('post', '/v1/inventory/receipts', {
          itemId: boxes,
          warehouseId: main,
          quantity: 1,
        })
      ).status,
    ).toBe(403);
    expect(
      (await keeper.send('post', '/v1/inventory/receipts', { itemId: boxes, warehouseId: main, quantity: 0 }))
        .status,
    ).toBe(400);
  });

  it('is shown per item with its history', async () => {
    const detail = await viewer.get(`/v1/inventory/items/${boxes}`);
    expect(detail.status).toBe(200);
    expect(detail.body.stock).toHaveLength(2);
    expect(detail.body.movements.length).toBeGreaterThanOrEqual(5);
  });
});

describe('the stock ledger in the database', () => {
  it('can only be added to', async () => {
    const row = await db.stockMovement.findFirstOrThrow({ where: { tenantId } });
    await expect(db.$executeRaw`SELECT 1`).resolves.toBeDefined();
    const runtime = await import('@smart-hr/database').then((m) =>
      m.createDatabaseClient({ connectionString: process.env.DATABASE_URL!, maxConnections: 1 }),
    );
    try {
      await expect(
        runtime.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
          await tx.$executeRaw`UPDATE "stock_movement" SET "quantity" = 999 WHERE "id" = ${row.id}::uuid`;
        }),
      ).rejects.toThrow();
      await expect(
        runtime.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
          await tx.$executeRaw`DELETE FROM "stock_movement" WHERE "id" = ${row.id}::uuid`;
        }),
      ).rejects.toThrow();
    } finally {
      await runtime.$disconnect();
    }
  });

  it('refuses negative stock even when issues race each other', async () => {
    const item = await db.inventoryItem.create({
      data: { tenantId, sku: 'RACE-1', name: 'Race', unit: 'pcs' },
    });
    await keeper.send('post', '/v1/inventory/receipts', { itemId: item.id, warehouseId: annex, quantity: 5 });
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        keeper.send('post', '/v1/inventory/issues', { itemId: item.id, warehouseId: annex, quantity: 1 }),
      ),
    );
    const succeeded = results.filter((r) => r.status === 201).length;
    expect(succeeded).toBe(5);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    expect(await onHand(item.id, annex)).toBe(0);
  });

  it('refuses a movement with the wrong sign, whatever the application does', async () => {
    const userId = (await db.user.findFirstOrThrow()).id;
    await expect(
      db.stockMovement.create({
        data: {
          tenantId,
          itemId: cables,
          warehouseId: main,
          kind: 'ISSUE',
          quantity: 5,
          occurredOn: new Date(),
          createdByUserId: userId,
        },
      }),
    ).rejects.toThrow();
  });
});

describe('plan gate', () => {
  it('hides inventory from an organisation whose plan lacks it', async () => {
    const lite = await fx.tenant('InvLite', 'ACTIVE', { plan: 'LITE' });
    const user = await fx.user('inv-lite');
    await fx.member(lite.id, user.id, true);
    const b = new Browser(app);
    await b.login(user.email);
    expect((await b.get('/v1/inventory/items')).status).toBe(403);
  });
});
