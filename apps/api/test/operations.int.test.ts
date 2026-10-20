/**
 * Operations workspaces through the real API and database: templates, items with stages and custom fields,
 * gap-free numbering under concurrent requests, who can see and change what (viewer, contributor, assignee,
 * manager), redefining stages safely, the plan's feature and workspace limit.
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
const year = new Date().getUTCFullYear();

interface Person {
  employeeId: string;
  browser: Browser;
}

async function person(
  label: string,
  tenant: string,
  company: string,
  ownerBrowser: Browser,
  permissions?: string[],
): Promise<Person> {
  const user = await fx.user(label);
  const m = await fx.member(tenant, user.id);
  if (permissions) {
    await fx.assign(tenant, m.id, await fx.customRole(tenant, label, permissions), {
      type: 'TENANT',
      id: tenant,
    });
  }
  const res = await ownerBrowser.send('post', '/v1/employees', {
    firstName: label,
    lastName: 'Test',
    companyId: company,
    dateOfJoining: `${year - 1}-01-01`,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await db.employee.update({ where: { id: res.body.id }, data: { membershipId: m.id } });
  const browser = new Browser(app);
  expect((await browser.login(user.email)).status).toBe(200);
  return { employeeId: res.body.id as string, browser };
}

let manager: Person;
let contributor: Person;
let viewer: Person;
let assignee: Person;
let stranger: Person;
let workspaceId: string;
let stages: { id: string; key: string; kind: string }[];
const stage = (key: string) => stages.find((s) => s.key === key)!.id;

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  const tenant = await fx.tenant('Operations');
  tenantId = tenant.id;
  const ownerUser = await fx.user('ops-owner');
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  acme = (await fx.company(tenantId, 'ACME')).id;

  manager = await person('ops-manager', tenantId, acme, owner, ['operations.manage']);
  contributor = await person('ops-contrib', tenantId, acme, owner, ['operations.contribute']);
  viewer = await person('ops-viewer', tenantId, acme, owner, ['operations.view']);
  assignee = await person('ops-assignee', tenantId, acme, owner);
  stranger = await person('ops-stranger', tenantId, acme, owner);
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await db.$disconnect();
});

const raise = (p: Person, title: string, extra: object = {}) =>
  p.browser.send('post', `/v1/operations/workspaces/${workspaceId}/items`, {
    title,
    values: { category: 'Access' },
    ...extra,
  });

describe('workspaces from templates', () => {
  it('offers the built-in templates', async () => {
    const res = await manager.browser.get('/v1/operations/templates');
    expect(res.status).toBe(200);
    expect((res.body as { key: string }[]).map((t) => t.key)).toContain('service_requests');
  });

  it('lets a manager create a workspace from a template, and nobody else', async () => {
    const body = { companyId: acme, code: 'it-help', name: 'IT help', template: 'service_requests' };
    expect((await contributor.browser.send('post', '/v1/operations/workspaces', body)).status).toBe(403);
    const created = await manager.browser.send('post', '/v1/operations/workspaces', body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.prefix).toBe('SR');
    workspaceId = created.body.id as string;
    expect((await manager.browser.send('post', '/v1/operations/workspaces', body)).status).toBe(400);

    const detail = await manager.browser.get(`/v1/operations/workspaces/${workspaceId}`);
    stages = detail.body.stages;
    expect(stages.map((s) => s.key)).toEqual(['new', 'in_progress', 'waiting', 'done', 'cancelled']);
    expect((detail.body.fields as { key: string }[]).map((f) => f.key)).toEqual(['category', 'location']);
  });

  it('shows the workspace to people who can see it and hides it from others', async () => {
    expect(((await viewer.browser.get('/v1/operations/workspaces')).body as unknown[]).length).toBe(1);
    expect(((await stranger.browser.get('/v1/operations/workspaces')).body as unknown[]).length).toBe(0);
    expect((await stranger.browser.get(`/v1/operations/workspaces/${workspaceId}`)).status).toBe(404);
  });
});

describe('raising items', () => {
  it('checks answers against the workspace’s fields', async () => {
    expect((await raise(contributor, 'No category', { values: {} })).status).toBe(400);
    expect((await raise(contributor, 'Bad choice', { values: { category: 'Nonsense' } })).status).toBe(400);
    expect(
      (await raise(contributor, 'Unknown', { values: { category: 'Access', colour: 'red' } })).status,
    ).toBe(400);
  });

  it('lets contributors raise items and viewers only look', async () => {
    const ok = await raise(contributor, 'Laptop will not start', { priority: 'HIGH' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.ref).toBe('SR-0001');
    expect(ok.body.stage.key).toBe('new');
    expect((await raise(viewer, 'Not allowed')).status).toBe(403);
    expect((await viewer.browser.get(`/v1/operations/workspaces/${workspaceId}/items`)).status).toBe(200);
  });

  it('numbers items without repeats or gaps when many are raised at once', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => raise(contributor, `Batch ${i}`)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.number as number).sort((a, b) => a - b);
    expect(numbers).toEqual([2, 3, 4, 5, 6, 7]);
  });
});

describe('working an item', () => {
  let itemId: string;

  it('lets a contributor assign it and move it along, recording each step', async () => {
    const created = await raise(contributor, 'Printer jam', {
      assigneeId: assignee.employeeId,
      dueDate: '2000-01-01',
    });
    itemId = created.body.id as string;
    expect(created.body.assignee.id).toBe(assignee.employeeId);
    expect(created.body.overdue).toBe(true);

    const moved = await contributor.browser.send('post', `/v1/operations/items/${itemId}/stage`, {
      stageId: stage('in_progress'),
      comment: 'On it',
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(201);
    const same = await contributor.browser.send('post', `/v1/operations/items/${itemId}/stage`, {
      stageId: stage('in_progress'),
    });
    expect(same.status).toBe(400);
    const bogus = await contributor.browser.send('post', `/v1/operations/items/${itemId}/stage`, {
      stageId: '019a0000-0000-7000-8000-000000000000',
    });
    expect(bogus.status).toBe(400);
  });

  it('lets the assignee see and work their item but not hand it to someone else', async () => {
    const mine = await assignee.browser.get('/v1/operations/mine');
    expect((mine.body as { id: string }[]).map((i) => i.id)).toContain(itemId);
    expect((await assignee.browser.get(`/v1/operations/items/${itemId}`)).status).toBe(200);
    const comment = await assignee.browser.send('post', `/v1/operations/items/${itemId}/comments`, {
      body: 'Replaced the toner',
    });
    expect(comment.status).toBe(201);
    const done = await assignee.browser.send('post', `/v1/operations/items/${itemId}/stage`, {
      stageId: stage('done'),
    });
    expect(done.status).toBe(201);
    expect(done.body.completedAt).not.toBeNull();
    expect(done.body.overdue).toBe(false);
    const reassign = await assignee.browser.send('patch', `/v1/operations/items/${itemId}`, {
      assigneeId: contributor.employeeId,
    });
    expect(reassign.status).toBe(403);
    expect(((await assignee.browser.get('/v1/operations/mine')).body as unknown[]).length).toBe(0);
  });

  it('keeps the history in order, and hides the item from people with no part in it', async () => {
    const detail = await contributor.browser.get(`/v1/operations/items/${itemId}`);
    expect((detail.body.events as { kind: string }[]).map((e) => e.kind)).toEqual([
      'CREATED',
      'ASSIGNED',
      'STAGE',
      'COMMENT',
      'STAGE',
    ]);
    expect((await stranger.browser.get(`/v1/operations/items/${itemId}`)).status).toBe(404);
    expect(
      (await stranger.browser.send('post', `/v1/operations/items/${itemId}/comments`, { body: 'hi' })).status,
    ).toBe(404);
    expect(
      (await viewer.browser.send('post', `/v1/operations/items/${itemId}/stage`, { stageId: stage('new') }))
        .status,
    ).toBe(403);
  });

  it('refuses to put an item into a stage from another workspace', async () => {
    const other = await manager.browser.send('post', '/v1/operations/workspaces', {
      companyId: acme,
      code: 'qa-1',
      name: 'QA',
      template: 'quality_audits',
    });
    const detail = await manager.browser.get(`/v1/operations/workspaces/${other.body.id}`);
    const foreign = detail.body.stages[0].id as string;
    const res = await contributor.browser.send('post', `/v1/operations/items/${itemId}/stage`, {
      stageId: foreign,
    });
    expect(res.status).toBe(400);
  });
});

describe('changing a workspace’s stages and fields', () => {
  const stagesBody = (extra: object[] = []) => [
    { key: 'new', label: 'New', kind: 'OPEN' },
    ...extra,
    { key: 'done', label: 'Done', kind: 'DONE' },
    { key: 'cancelled', label: 'Cancelled', kind: 'CANCELLED' },
  ];

  it('refuses a definition that makes no sense', async () => {
    const noDone = await manager.browser.send('put', `/v1/operations/workspaces/${workspaceId}/definition`, {
      stages: [
        { key: 'new', label: 'New', kind: 'OPEN' },
        { key: 'later', label: 'Later', kind: 'OPEN' },
      ],
      fields: [],
    });
    expect(noDone.status).toBe(400);
    const choice = await manager.browser.send('put', `/v1/operations/workspaces/${workspaceId}/definition`, {
      stages: stagesBody(),
      fields: [{ key: 'size', label: 'Size', type: 'SELECT', options: ['only-one'] }],
    });
    expect(choice.status).toBe(400);
  });

  it('won’t drop a stage that still holds items, and applies a valid change', async () => {
    const blocked = await manager.browser.send('put', `/v1/operations/workspaces/${workspaceId}/definition`, {
      stages: stagesBody(),
      fields: [],
    });
    // Every item sits in "new" or "done", so dropping the empty middle stages is allowed.
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(200);
    const inUse = await manager.browser.send('put', `/v1/operations/workspaces/${workspaceId}/definition`, {
      stages: [
        { key: 'open', label: 'Open', kind: 'OPEN' },
        { key: 'done', label: 'Done', kind: 'DONE' },
      ],
      fields: [],
    });
    expect(inUse.status).toBe(409);
    expect(inUse.body.code).toBe('STAGE_IN_USE');

    const ok = await manager.browser.send('put', `/v1/operations/workspaces/${workspaceId}/definition`, {
      stages: stagesBody([{ key: 'review', label: 'Review', kind: 'OPEN' }]),
      fields: [
        { key: 'category', label: 'Category', type: 'SELECT', required: true, options: ['Access', 'Other'] },
        { key: 'cost', label: 'Cost', type: 'NUMBER' },
      ],
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const detail = await manager.browser.get(`/v1/operations/workspaces/${workspaceId}`);
    expect((detail.body.stages as { key: string }[]).map((s) => s.key)).toContain('review');
    expect(
      (
        await contributor.browser.send('put', `/v1/operations/workspaces/${workspaceId}/definition`, {
          stages: [],
          fields: [],
        })
      ).status,
    ).toBe(403);
  });
});

describe('plans', () => {
  it('limits templates-only plans to templates and caps the number of workspaces', async () => {
    const pro = await fx.tenant('OperationsPro', 'ACTIVE', { plan: 'PRO' });
    const proOwnerUser = await fx.user('ops-pro-owner');
    await fx.member(pro.id, proOwnerUser.id, true);
    const b = new Browser(app);
    await b.login(proOwnerUser.email);
    const company = (await fx.company(pro.id, 'PROCO')).id;

    const custom = await b.send('post', '/v1/operations/workspaces', {
      companyId: company,
      code: 'c-1',
      name: 'Custom',
    });
    expect(custom.status).toBe(403);
    for (const [i, template] of ['service_requests', 'quality_audits', 'support_tickets'].entries()) {
      const res = await b.send('post', '/v1/operations/workspaces', {
        companyId: company,
        code: `t-${i}`,
        name: `Workspace ${i}`,
        template,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    const fourth = await b.send('post', '/v1/operations/workspaces', {
      companyId: company,
      code: 't-9',
      name: 'One too many',
      template: 'production_batches',
    });
    expect(fourth.status).toBe(403);
    expect(fourth.body.code).toBe('LIMIT_REACHED');
    const first = ((await b.get('/v1/operations/workspaces')).body as { id: string }[])[0]!;
    const def = await b.send('put', `/v1/operations/workspaces/${first.id}/definition`, {
      stages: [
        { key: 'a', label: 'A', kind: 'OPEN' },
        { key: 'b', label: 'B', kind: 'DONE' },
      ],
      fields: [],
    });
    expect(def.status).toBe(403);
  });

  it('hides operations from a plan without it', async () => {
    const lite = await fx.tenant('OperationsLite', 'ACTIVE', { plan: 'LITE' });
    const user = await fx.user('ops-lite');
    await fx.member(lite.id, user.id, true);
    const b = new Browser(app);
    await b.login(user.email);
    expect((await b.get('/v1/operations/workspaces')).status).toBe(403);
  });
});
