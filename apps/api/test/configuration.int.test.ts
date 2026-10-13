/**
 * Organisation settings and master data through the real API and database.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { withContext, type DatabaseClient } from '@smart-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATABASE } from '../src/infra/tokens.js';
import { Browser, Fixtures, ownerClient, startApp, testEnv } from './helpers.js';

let app: NestExpressApplication;
let appDb: DatabaseClient;
const db = ownerClient();
const fx = new Fixtures(db);

beforeAll(async () => {
  app = await startApp(testEnv());
  appDb = app.get(DATABASE);
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await db.$disconnect();
});

async function organisation(name: string) {
  const tenant = await fx.tenant(name);
  async function person(
    label: string,
    options: { owner?: boolean; roles?: { id: string; scope?: { type: 'COMPANY'; id: string } }[] } = {},
  ) {
    const user = await fx.user(`${name}-${label}`);
    const membership = await fx.member(tenant.id, user.id, options.owner ?? false);
    for (const r of options.roles ?? []) await fx.assign(tenant.id, membership.id, r.id, r.scope);
    const browser = new Browser(app);
    expect((await browser.login(user.email)).status).toBe(200);
    return { user, membership, browser };
  }
  const owner = await person('owner', { owner: true });
  return { tenant, owner, person };
}

type Setting = { key: string; value: unknown; isDefault: boolean; group: string };
const byKey = (body: unknown) => Object.fromEntries((body as Setting[]).map((s) => [s.key, s]));

describe('organisation settings', () => {
  it('gives every member the effective settings, with defaults until changed', async () => {
    const org = await organisation('Cfg');
    const member = await org.person('member');
    const res = await member.browser.get('/v1/tenant/configuration');
    expect(res.status).toBe(200);
    const settings = byKey(res.body);
    expect(settings.timezone).toMatchObject({ value: 'Asia/Kolkata', isDefault: true, group: 'Locale' });
    expect(settings.financial_year_start_month).toMatchObject({ value: 4, isDefault: true });
    expect(Object.keys(settings).sort()).toEqual([
      'date_format',
      'default_currency',
      'employee_code_prefix',
      'financial_year_start_month',
      'timezone',
      'week_start',
    ]);
  });

  it('saves valid changes together, normalised, and records what changed', async () => {
    const org = await organisation('CfgSave');
    const res = await org.owner.browser.send('put', '/v1/tenant/configuration', {
      values: {
        default_currency: 'usd',
        timezone: 'Asia/Dubai',
        financial_year_start_month: '1',
        week_start: 'MONDAY',
      },
    });
    expect(res.status).toBe(200);
    // week_start was already the default: not a change.
    expect((res.body.changed as string[]).sort()).toEqual([
      'default_currency',
      'financial_year_start_month',
      'timezone',
    ]);
    expect(res.body.values).toMatchObject({
      default_currency: 'USD',
      timezone: 'Asia/Dubai',
      financial_year_start_month: 1,
    });

    const event = await db.auditEvent.findFirstOrThrow({
      where: { tenantId: org.tenant.id, action: 'tenant.configuration.update' },
    });
    expect(event.metadata).toMatchObject({ changed: { default_currency: { from: 'INR', to: 'USD' } } });

    // Back to the default: the stored value goes away.
    await org.owner.browser.send('put', '/v1/tenant/configuration', { values: { default_currency: 'INR' } });
    const after = byKey((await org.owner.browser.get('/v1/tenant/configuration')).body);
    expect(after.default_currency).toMatchObject({ value: 'INR', isDefault: true });
    expect(after.timezone).toMatchObject({ value: 'Asia/Dubai', isDefault: false });
  });

  it('refuses unknown keys and invalid values, saving nothing', async () => {
    const org = await organisation('CfgBad');
    const res = await org.owner.browser.send('put', '/v1/tenant/configuration', {
      values: { timezone: 'Mars/Olympus', default_currency: 'EUR', colour: 'teal' },
    });
    expect(res.status).toBe(400);
    expect((res.body.errors as { path: string }[]).map((e) => e.path).sort()).toEqual([
      'values.colour',
      'values.timezone',
    ]);
    const settings = byKey((await org.owner.browser.get('/v1/tenant/configuration')).body);
    expect(settings.default_currency!.value).toBe('INR');

    // The one-key endpoint follows the same rules.
    expect(
      (await org.owner.browser.send('put', '/v1/tenant/settings/colour', { value: 'teal' })).body.code,
    ).toBe('UNKNOWN_SETTING');
    expect(
      (await org.owner.browser.send('put', '/v1/tenant/settings/week_start', { value: 'FRIDAY' })).status,
    ).toBe(400);
  });

  it('needs settings.manage for the whole organisation', async () => {
    const org = await organisation('CfgPerm');
    const company = await fx.company(org.tenant.id, 'CFGCO');
    const settingsRole = await fx.customRole(org.tenant.id, 'Settings', ['settings.manage']);
    const member = await org.person('member');
    const companyAdmin = await org.person('coadmin', {
      roles: [{ id: settingsRole, scope: { type: 'COMPANY', id: company.id } }],
    });
    const tenantAdmin = await org.person('admin', { roles: [{ id: settingsRole }] });
    const body = { values: { week_start: 'SUNDAY' } };

    expect((await member.browser.send('put', '/v1/tenant/configuration', body)).status).toBe(403);
    expect((await companyAdmin.browser.send('put', '/v1/tenant/configuration', body)).status).toBe(403);
    expect(
      (await companyAdmin.browser.send('put', '/v1/tenant/settings/week_start', { value: 'SUNDAY' })).status,
    ).toBe(403);
    expect((await tenantAdmin.browser.send('put', '/v1/tenant/configuration', body)).status).toBe(200);
  });

  it('keeps each organisation’s settings to itself', async () => {
    const a = await organisation('CfgA');
    const b = await organisation('CfgB');
    await a.owner.browser.send('put', '/v1/tenant/configuration', { values: { date_format: 'YYYY-MM-DD' } });
    const settings = byKey((await b.owner.browser.get('/v1/tenant/configuration')).body);
    expect(settings.date_format).toMatchObject({ value: 'DD/MM/YYYY', isDefault: true });
  });
});

describe('master data', () => {
  it('lists the reference lists and offers suggestions once', async () => {
    const org = await organisation('Md');
    const catalogue = await org.owner.browser.get('/v1/master-data');
    const types = (catalogue.body as { list: string; active: number; suggestionsAvailable: number }[]).find(
      (l) => l.list === 'employment_type',
    );
    expect(types).toMatchObject({ active: 0, suggestionsAvailable: 5 });

    // An existing code is never overwritten by a suggestion.
    await org.owner.browser.send('post', '/v1/master-data/employment_type', {
      code: 'ft',
      name: 'Permanent',
    });
    const added = await org.owner.browser.send('post', '/v1/master-data/employment_type/suggestions');
    expect(added.body).toEqual({ added: 4 });
    expect(
      (await org.owner.browser.send('post', '/v1/master-data/employment_type/suggestions')).body,
    ).toEqual({
      added: 0,
    });
    const values = await org.owner.browser.get('/v1/master-data/employment_type');
    expect((values.body as { code: string; name: string }[]).find((v) => v.code === 'FT')?.name).toBe(
      'Permanent',
    );
    expect(values.body).toHaveLength(5);
  });

  it('adds, renames, archives and restores values, keeping codes unique per list', async () => {
    const org = await organisation('MdCrud');
    const other = await organisation('MdOther');
    const created = await org.owner.browser.send('post', '/v1/master-data/designation', {
      code: 'sde-2',
      name: 'Software Engineer II',
      sortOrder: 20,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ code: 'SDE-2', status: 'ACTIVE' });

    const dup = await org.owner.browser.send('post', '/v1/master-data/designation', {
      code: 'SDE-2',
      name: 'Again',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('CODE_TAKEN');
    // Same code in another list, or another organisation, is fine.
    expect(
      (await org.owner.browser.send('post', '/v1/master-data/grade', { code: 'SDE-2', name: 'Grade' }))
        .status,
    ).toBe(201);
    expect(
      (
        await other.owner.browser.send('post', '/v1/master-data/designation', {
          code: 'SDE-2',
          name: 'Theirs',
        })
      ).status,
    ).toBe(201);

    const url = `/v1/master-data/designation/${created.body.id}`;
    expect((await org.owner.browser.send('patch', url, { name: 'Engineer II' })).body.name).toBe(
      'Engineer II',
    );
    expect((await org.owner.browser.send('patch', url, { status: 'ARCHIVED' })).body.status).toBe('ARCHIVED');
    expect((await org.owner.browser.get('/v1/master-data/designation')).body).toEqual([]);
    expect(
      (await org.owner.browser.get('/v1/master-data/designation?includeArchived=true')).body,
    ).toHaveLength(1);
    // Archived codes stay taken, so old records keep their meaning.
    expect(
      (await org.owner.browser.send('post', '/v1/master-data/designation', { code: 'SDE-2', name: 'New' }))
        .status,
    ).toBe(409);
    expect((await org.owner.browser.send('patch', url, { status: 'ACTIVE' })).body.status).toBe('ACTIVE');

    const actions = await db.auditEvent.findMany({
      where: { tenantId: org.tenant.id, targetId: created.body.id },
      select: { action: true },
    });
    expect(actions.map((a) => a.action).sort()).toEqual([
      'master_data.value.archive',
      'master_data.value.create',
      'master_data.value.restore',
      'master_data.value.update',
    ]);

    // Another organisation's value and an unknown list both look missing.
    expect((await other.owner.browser.send('patch', url, { name: 'Hijack' })).status).toBe(404);
    expect((await org.owner.browser.get('/v1/master-data/blood_group')).status).toBe(404);
  });

  it('lets every member read lists but only whole-organisation managers change them', async () => {
    const org = await organisation('MdPerm');
    const company = await fx.company(org.tenant.id, 'MDCO');
    const role = await fx.customRole(org.tenant.id, 'Master data', ['master_data.manage']);
    const member = await org.person('member');
    const scoped = await org.person('scoped', {
      roles: [{ id: role, scope: { type: 'COMPANY', id: company.id } }],
    });
    const manager = await org.person('manager', { roles: [{ id: role }] });
    const body = { code: 'CC-01', name: 'Head office' };

    expect((await member.browser.get('/v1/master-data/cost_centre')).status).toBe(200);
    expect((await member.browser.send('post', '/v1/master-data/cost_centre', body)).status).toBe(403);
    expect((await scoped.browser.send('post', '/v1/master-data/cost_centre', body)).status).toBe(403);
    expect((await manager.browser.send('post', '/v1/master-data/cost_centre', body)).status).toBe(201);
  });

  it('cannot change a value’s code or delete it, even bypassing the API', async () => {
    const org = await organisation('MdDb');
    const created = await org.owner.browser.send('post', '/v1/master-data/grade', {
      code: 'G1',
      name: 'Grade 1',
    });
    const asApp = (sql: (tx: Parameters<Parameters<typeof withContext>[2]>[0]) => Promise<unknown>) =>
      withContext(appDb, { tenantId: org.tenant.id }, sql);
    await expect(
      asApp((tx) => tx.$executeRaw`UPDATE lookup_value SET code = 'G9' WHERE id = ${created.body.id}::uuid`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asApp((tx) => tx.$executeRaw`DELETE FROM lookup_value WHERE id = ${created.body.id}::uuid`),
    ).rejects.toThrow(/permission denied/);
  });
});
