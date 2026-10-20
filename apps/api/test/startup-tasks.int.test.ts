/**
 * First-run setup the API can do for itself on a host with no shell: creating the first organisation and
 * its owner from settings, only when none exists, and never exposing the password.
 */
import { verifyPassword } from '@smart-hr/auth';
import type { DatabaseClient } from '@smart-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapTenant, BootstrapError } from '../src/cli/bootstrap-core.js';
import { runStartupTasks, slugFromName } from '../src/startup-tasks.js';
import { Fixtures, ownerClient, requireEnv } from './helpers.js';

let db: DatabaseClient;
let fixtures: Fixtures;
const run = Date.now().toString(36);
const slugs: string[] = [];
const emails: string[] = [];

beforeAll(() => {
  db = ownerClient();
  fixtures = new Fixtures(db);
});

afterAll(async () => {
  const tenants = await db.tenant.findMany({ where: { slug: { in: slugs } }, select: { id: true } });
  const users = await db.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
  for (const t of tenants) fixtures.trackTenant(t.id);
  for (const u of users) fixtures.trackUser(u.id);
  await fixtures.cleanup();
  await db.$disconnect();
});

/** The same client, but reporting no organisations, so the first-run branch can be tested on a used database. */
function asEmptyDatabase(real: DatabaseClient): DatabaseClient {
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'tenant') {
        return new Proxy(target.tenant, {
          get: (t, p, r): unknown => (p === 'findMany' ? () => Promise.resolve([]) : Reflect.get(t, p, r)),
        });
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
}

const password = 'amber lantern orchard 58';

describe('slugFromName', () => {
  it('makes a URL-safe key', () => {
    expect(slugFromName('Acme Health Pvt. Ltd.')).toBe('acme-health-pvt-ltd');
    expect(slugFromName('  ***  ')).toBe('organisation');
  });
});

describe('startup tasks', () => {
  it('do nothing unless STARTUP_TASKS is on', async () => {
    const result = await runStartupTasks(
      { DATABASE_MIGRATOR_URL: requireEnv('DATABASE_MIGRATOR_URL') },
      { db },
    );
    expect(result).toEqual({ ran: false, messages: [] });
  });

  it('only refresh plans and roles when organisations already exist, ignoring the first-run settings', async () => {
    const email = `owner-${run}-a@startup.test`;
    emails.push(email);
    const result = await runStartupTasks(
      {
        STARTUP_TASKS: 'true',
        DATABASE_MIGRATOR_URL: requireEnv('DATABASE_MIGRATOR_URL'),
        BOOTSTRAP_TENANT_NAME: `Should Not Exist ${run}`,
        BOOTSTRAP_ADMIN_EMAIL: email,
        BOOTSTRAP_ADMIN_NAME: 'Nobody',
        BOOTSTRAP_ADMIN_PASSWORD: password,
      },
      { db },
    );
    expect(result.ran).toBe(true);
    expect(result.created).toBeUndefined();
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  });

  it('create the first organisation and its owner on an empty database, without printing the password', async () => {
    const email = `Owner-${run}-b@Startup.test`;
    const name = `First Run Org ${run}`;
    slugs.push(slugFromName(name));
    emails.push(email.toLowerCase());
    const result = await runStartupTasks(
      {
        STARTUP_TASKS: 'true',
        DATABASE_MIGRATOR_URL: requireEnv('DATABASE_MIGRATOR_URL'),
        BOOTSTRAP_TENANT_NAME: name,
        BOOTSTRAP_ADMIN_EMAIL: email,
        BOOTSTRAP_ADMIN_NAME: 'First Owner',
        BOOTSTRAP_ADMIN_PASSWORD: password,
      },
      { db: asEmptyDatabase(db) },
    );
    expect(result.created).toBe(slugFromName(name));
    expect(result.messages.join('\n')).not.toContain(password);

    const user = await db.user.findUniqueOrThrow({ where: { email: email.toLowerCase() } });
    expect(await verifyPassword(user.passwordHash!, password)).toBe(true);
    const membership = await db.tenantMembership.findFirstOrThrow({
      where: { userId: user.id, tenant: { slug: slugFromName(name) } },
      include: { tenant: { include: { subscription: true } } },
    });
    expect(membership.isTenantAdmin).toBe(true);
    expect(membership.tenant.subscription?.status).toBe('ACTIVE');
  });

  it('report a weak password and keep going instead of crashing', async () => {
    const result = await runStartupTasks(
      {
        STARTUP_TASKS: 'true',
        DATABASE_MIGRATOR_URL: requireEnv('DATABASE_MIGRATOR_URL'),
        BOOTSTRAP_TENANT_NAME: `Weak Org ${run}`,
        BOOTSTRAP_ADMIN_EMAIL: `weak-${run}@startup.test`,
        BOOTSTRAP_ADMIN_NAME: 'Weak',
        BOOTSTRAP_ADMIN_PASSWORD: 'short',
      },
      { db: asEmptyDatabase(db) },
    );
    expect(result.created).toBeUndefined();
    expect(result.messages.join('\n')).toMatch(/Password rejected/);
    expect(result.messages.join('\n')).not.toContain('short');
    expect(await db.tenant.findUnique({ where: { slug: slugFromName(`Weak Org ${run}`) } })).toBeNull();
  });

  it('can make the owners of the oldest organisation platform administrators, only when asked', async () => {
    const email = `owner-${run}-p@startup.test`;
    emails.push(email);
    const slug = `plat-${run}`;
    slugs.push(slug);
    await bootstrapTenant(db, { slug, name: `Plat ${run}`, adminEmail: email, adminName: 'P', adminPassword: password });
    expect((await db.user.findUniqueOrThrow({ where: { email } })).isPlatformAdmin).toBe(false);

    await runStartupTasks({ STARTUP_TASKS: 'true', DATABASE_MIGRATOR_URL: requireEnv('DATABASE_MIGRATOR_URL') }, { db });
    expect((await db.user.findUniqueOrThrow({ where: { email } })).isPlatformAdmin).toBe(false);

    // The oldest organisation in a shared test database isn't this one, so act on a database that has only it.
    const only = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'tenant') {
          return new Proxy(target.tenant, {
            get: (t, p, r): unknown =>
              p === 'findFirst'
                ? () => target.tenant.findUnique({ where: { slug }, select: { id: true, name: true } })
                : Reflect.get(t, p, r),
          });
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    const result = await runStartupTasks(
      { STARTUP_TASKS: 'true', PLATFORM_ADMIN_FIRST_OWNER: 'true', DATABASE_MIGRATOR_URL: requireEnv('DATABASE_MIGRATOR_URL') },
      { db: only },
    );
    expect(result.messages.join('\n')).toMatch(/granted to 1 owner/);
    expect((await db.user.findUniqueOrThrow({ where: { email } })).isPlatformAdmin).toBe(true);
  });

  it('bootstrapTenant refuses a password that breaks the policy', async () => {
    await expect(
      bootstrapTenant(db, {
        slug: `nope-${run}`,
        name: 'Nope',
        adminEmail: 'x@startup.test',
        adminName: 'X',
        adminPassword: 'abc',
      }),
    ).rejects.toBeInstanceOf(BootstrapError);
  });
});
