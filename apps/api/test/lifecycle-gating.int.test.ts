/** The employment lifecycle (transfers, promotions, exits) is a plan feature: Lite does not get it, Pro does. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import { Browser, Fixtures, ownerClient, startApp, testEnv } from './helpers.js';

let app: NestExpressApplication;
const db = ownerClient();
const fx = new Fixtures(db);

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await db.$disconnect();
});

async function owner(name: string, plan: string) {
  const tenant = await fx.tenant(name, 'ACTIVE', { plan });
  const user = await fx.user(`${name}-owner`);
  await fx.member(tenant.id, user.id, true);
  const b = new Browser(app);
  expect((await b.login(user.email)).status).toBe(200);
  return b;
}

describe('employment lifecycle plan gating', () => {
  const path = `/v1/employees/${randomUUID()}/lifecycle`;
  const body = { action: 'record_notice', effectiveDate: '2027-01-01' };

  it('is refused on a plan without hr.lifecycle', async () => {
    const lite = await owner('LifecycleLite', 'LITE');
    const res = await lite.send('post', path, body);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ENTITLEMENT_REQUIRED');
  });

  it('gets past the plan check on a plan that includes it', async () => {
    const pro = await owner('LifecyclePro', 'PRO');
    const res = await pro.send('post', path, body);
    expect(res.body.code).not.toBe('ENTITLEMENT_REQUIRED');
  });
});
