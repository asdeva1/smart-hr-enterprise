/**
 * Performance management through the real API and database: HR runs a cycle, people set weighted goals, rate
 * themselves, their manager completes the review, they acknowledge it, and everything freezes when HR closes the
 * cycle. Who can see what, the order of steps and the weight limit are held by the API and again by the database.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import { createDatabaseClient, withTenant } from '@smart-hr/database';
import { Browser, Fixtures, ownerClient, requireEnv, startApp, testEnv } from './helpers.js';

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

async function person(label: string, managerId?: string, permissions?: string[]): Promise<Person> {
  const user = await fx.user(label);
  const m = await fx.member(tenantId, user.id);
  if (permissions) {
    await fx.assign(tenantId, m.id, await fx.customRole(tenantId, label, permissions), {
      type: 'TENANT',
      id: tenantId,
    });
  }
  const res = await owner.send('post', '/v1/employees', {
    firstName: label,
    lastName: 'Test',
    companyId: acme,
    dateOfJoining: `${year - 1}-01-01`,
    ...(managerId ? { managerId } : {}),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await db.employee.update({ where: { id: res.body.id }, data: { membershipId: m.id } });
  const browser = new Browser(app);
  expect((await browser.login(user.email)).status).toBe(200);
  return { employeeId: res.body.id as string, browser };
}

let hr: Person;
let boss: Person;
let asha: Person;
let ravi: Person;
let outsider: Person;
let cycleId: string;
const P = '/v1/performance';

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  const tenant = await fx.tenant('Performance');
  tenantId = tenant.id;
  const ownerUser = await fx.user('pf-owner');
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  acme = (await fx.company(tenantId, 'ACME')).id;

  hr = await person('pf-hr', undefined, ['performance.manage']);
  boss = await person('pf-boss');
  asha = await person('pf-asha', boss.employeeId);
  ravi = await person('pf-ravi', boss.employeeId);
  outsider = await person('pf-outsider');
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await db.$disconnect();
});

describe('review cycles', () => {
  it('are set up by HR only, with a unique name per company', async () => {
    const body = {
      companyId: acme,
      name: 'FY test',
      periodFrom: `${year}-04-01`,
      periodTo: `${year + 1}-03-31`,
    };
    expect((await boss.browser.send('post', `${P}/cycles`, body)).status).toBe(403);
    const made = await hr.browser.send('post', `${P}/cycles`, body);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body).toMatchObject({ status: 'DRAFT', people: 0 });
    cycleId = made.body.id;
    expect((await hr.browser.send('post', `${P}/cycles`, body)).status).toBe(400);
    expect(
      (
        await hr.browser.send('post', `${P}/cycles`, {
          ...body,
          name: 'Backwards',
          periodTo: `${year}-01-01`,
        })
      ).status,
    ).toBe(400);
  });

  it('show up for HR but not for people who only take part', async () => {
    expect((await hr.browser.get(`${P}/cycles`)).body).toHaveLength(1);
    expect((await asha.browser.get(`${P}/cycles`)).body).toHaveLength(0);
  });
});

describe('goals', () => {
  it('can be set by the person and their manager, and weights stop at 100', async () => {
    const mine = await asha.browser.send('post', `${P}/goals`, { cycleId, title: 'Cut returns', weight: 60 });
    expect(mine.status, JSON.stringify(mine.body)).toBe(201);
    const tooMuch = await asha.browser.send('post', `${P}/goals`, { cycleId, title: 'Too much', weight: 50 });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.code).toBe('WEIGHT_TOO_HIGH');
    const byManager = await boss.browser.send('post', `${P}/goals`, {
      cycleId,
      employeeId: asha.employeeId,
      title: 'Train two juniors',
      weight: 40,
    });
    expect(byManager.status, JSON.stringify(byManager.body)).toBe(201);
    expect(
      (
        await outsider.browser.send('post', `${P}/goals`, {
          cycleId,
          employeeId: asha.employeeId,
          title: 'Sneaky goal',
          weight: 1,
        })
      ).status,
    ).toBe(403);
    // A dropped goal frees its weight.
    expect(
      (await asha.browser.send('patch', `${P}/goals/${byManager.body.id}`, { status: 'DROPPED' })).status,
    ).toBe(200);
    expect(
      (await asha.browser.send('post', `${P}/goals`, { cycleId, title: 'Mentoring', weight: 40 })).status,
    ).toBe(201);
  });

  it('keep progress between 0 and 100 and are private to the person, their manager and HR', async () => {
    const mine = (await asha.browser.get(`${P}/mine`)).body.cycles[0].goals as {
      id: string;
      title: string;
    }[];
    const goal = mine.find((g) => g.title === 'Cut returns')!;
    expect((await asha.browser.send('patch', `${P}/goals/${goal.id}`, { progress: 150 })).status).toBe(400);
    expect((await asha.browser.send('patch', `${P}/goals/${goal.id}`, { progress: 50 })).status).toBe(200);
    expect((await ravi.browser.send('patch', `${P}/goals/${goal.id}`, { progress: 99 })).status).toBe(404);
    expect((await boss.browser.send('patch', `${P}/goals/${goal.id}`, { progress: 70 })).status).toBe(200);
  });
});

describe('opening a cycle and the review itself', () => {
  it('starts a review for everyone and only once', async () => {
    expect((await boss.browser.send('post', `${P}/cycles/${cycleId}/open`)).status).toBe(403);
    const opened = await hr.browser.send('post', `${P}/cycles/${cycleId}/open`);
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);
    expect(opened.body).toMatchObject({ status: 'OPEN', people: 5, completed: 0 });
    expect((await hr.browser.send('post', `${P}/cycles/${cycleId}/open`)).status).toBe(409);
    const all = (await hr.browser.get(`${P}/cycles/${cycleId}/appraisals`)).body as {
      employee: { id: string };
    }[];
    expect(all).toHaveLength(5);
  });

  it('shows each person their own review and the manager their team, nobody else’s', async () => {
    const mine = (await asha.browser.get(`${P}/mine`)).body.cycles[0];
    expect(mine.appraisal).toMatchObject({ status: 'AWAITING_SELF' });
    const ashaReview = mine.appraisal.id as string;
    expect((await outsider.browser.get(`${P}/appraisals/${ashaReview}`)).status).toBe(404);
    expect((await ravi.browser.get(`${P}/appraisals/${ashaReview}`)).status).toBe(404);
    expect((await boss.browser.get(`${P}/appraisals/${ashaReview}`)).status).toBe(200);
    const team = (await boss.browser.get(`${P}/cycles/${cycleId}/appraisals`)).body as unknown[];
    expect(team).toHaveLength(3); // their own and their two reports
    expect((await outsider.browser.get(`${P}/cycles/${cycleId}/appraisals`)).body).toHaveLength(1);
  });

  it('goes in order: self review, manager review, acknowledgement', async () => {
    const ashaReview = (await asha.browser.get(`${P}/mine`)).body.cycles[0].appraisal.id as string;

    const early = await boss.browser.send('post', `${P}/appraisals/${ashaReview}/review`, {
      rating: 4,
      comment: 'Too early',
    });
    expect(early.status).toBe(409);
    expect(
      (await asha.browser.send('post', `${P}/appraisals/${ashaReview}/self`, { rating: 6, comment: 'x' }))
        .status,
    ).toBe(400);
    expect(
      (
        await ravi.browser.send('post', `${P}/appraisals/${ashaReview}/self`, {
          rating: 4,
          comment: 'Not mine',
        })
      ).status,
    ).toBe(404);

    const self = await asha.browser.send('post', `${P}/appraisals/${ashaReview}/self`, {
      rating: 4,
      comment: 'Returns are down and I trained two people.',
    });
    expect(self.status, JSON.stringify(self.body)).toBe(201);
    expect(self.body).toMatchObject({ status: 'AWAITING_MANAGER', selfRating: 4, managerRating: null });
    expect(
      (await asha.browser.send('post', `${P}/appraisals/${ashaReview}/self`, { rating: 5, comment: 'Again' }))
        .status,
    ).toBe(409);

    expect(((await boss.browser.get(`${P}/to-review`)).body as { id: string }[]).map((a) => a.id)).toEqual([
      ashaReview,
    ]);
    expect(
      (
        await asha.browser.send('post', `${P}/appraisals/${ashaReview}/review`, {
          rating: 5,
          comment: 'Self-approval',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await outsider.browser.send('post', `${P}/appraisals/${ashaReview}/review`, {
          rating: 1,
          comment: 'Not their report',
        })
      ).status,
    ).toBe(404);

    const done = await boss.browser.send('post', `${P}/appraisals/${ashaReview}/review`, {
      rating: 3,
      comment: 'Solid year; the mentoring goal needs more time.',
    });
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(done.body).toMatchObject({
      status: 'COMPLETED',
      managerRating: 3,
      goalProgress: expect.any(Number),
    });
    expect(
      (
        await boss.browser.send('post', `${P}/appraisals/${ashaReview}/review`, {
          rating: 5,
          comment: 'Changed my mind',
        })
      ).status,
    ).toBe(409);

    expect((await ravi.browser.send('post', `${P}/appraisals/${ashaReview}/acknowledge`)).status).toBe(404);
    const ack = await asha.browser.send('post', `${P}/appraisals/${ashaReview}/acknowledge`);
    expect(ack.body.status).toBe('ACKNOWLEDGED');
    expect((await asha.browser.send('post', `${P}/appraisals/${ashaReview}/acknowledge`)).status).toBe(409);
  });

  it('holds back the manager’s rating from the employee until the review is complete', async () => {
    const raviReview = (await ravi.browser.get(`${P}/mine`)).body.cycles[0].appraisal.id as string;
    await ravi.browser.send('post', `${P}/appraisals/${raviReview}/self`, {
      rating: 5,
      comment: 'Great year all round.',
    });
    // Even if a rating were written early, the employee's own view of an unfinished review leaves it out.
    const view = (await ravi.browser.get(`${P}/appraisals/${raviReview}`)).body;
    expect(view).toMatchObject({ status: 'AWAITING_MANAGER', managerRating: null, managerComment: null });
  });
});

describe('closing a cycle', () => {
  it('freezes goals and reviews', async () => {
    expect((await boss.browser.send('post', `${P}/cycles/${cycleId}/close`)).status).toBe(403);
    const closed = await hr.browser.send('post', `${P}/cycles/${cycleId}/close`);
    expect(closed.status, JSON.stringify(closed.body)).toBe(201);
    expect(closed.body).toMatchObject({ status: 'CLOSED', completed: 1 });
    expect((await hr.browser.send('post', `${P}/cycles/${cycleId}/close`)).status).toBe(409);

    const goal = (await asha.browser.get(`${P}/mine`)).body.cycles[0].goals[0] as { id: string };
    const late = await asha.browser.send('patch', `${P}/goals/${goal.id}`, { progress: 100 });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('CYCLE_CLOSED');
    const raviReview = (await ravi.browser.get(`${P}/mine`)).body.cycles[0].appraisal.id as string;
    expect(
      (
        await boss.browser.send('post', `${P}/appraisals/${raviReview}/review`, {
          rating: 4,
          comment: 'Too late',
        })
      ).status,
    ).toBe(409);
  });
});

describe('the database holds the rules too', () => {
  it('refuses ratings out of range, skipped steps and a cycle that goes backwards', async () => {
    const row = await db.appraisal.findFirstOrThrow({ where: { tenantId, status: 'AWAITING_SELF' } });
    await expect(
      db.$executeRaw`UPDATE appraisal SET self_rating = 9 WHERE id = ${row.id}::uuid`,
    ).rejects.toThrow();
    await expect(
      db.$executeRaw`UPDATE appraisal SET status = 'COMPLETED', self_rating = 3, manager_rating = 3, completed_at = now(), self_submitted_at = now() WHERE id = ${row.id}::uuid`,
    ).rejects.toThrow();
    await expect(
      db.$executeRaw`UPDATE review_cycle SET status = 'OPEN' WHERE id = ${cycleId}::uuid`,
    ).rejects.toThrow();
    await expect(
      db.$executeRaw`INSERT INTO performance_goal (id, tenant_id, cycle_id, employee_id, title, weight, progress, updated_at)
        VALUES (gen_random_uuid(), ${tenantId}::uuid, ${cycleId}::uuid, ${row.employeeId}::uuid, 'Late', 10, 0, now())`,
    ).rejects.toThrow();
  });
});

describe('feedback', () => {
  it('goes from one colleague to another and is seen only by those two', async () => {
    const sent = await asha.browser.send('post', `${P}/feedback`, {
      toId: ravi.employeeId,
      kind: 'PRAISE',
      message: 'Thanks for covering my shift.',
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(
      (
        await asha.browser.send('post', `${P}/feedback`, {
          toId: asha.employeeId,
          kind: 'PRAISE',
          message: 'Me',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await asha.browser.send('post', `${P}/feedback`, {
          toId: ravi.employeeId,
          kind: 'PRAISE',
          message: ' ',
        })
      ).status,
    ).toBe(400);
    const raviSees = (await ravi.browser.get(`${P}/feedback`)).body;
    expect(raviSees.received).toHaveLength(1);
    expect(raviSees.received[0]).toMatchObject({
      kind: 'PRAISE',
      from: { name: expect.stringContaining('pf-asha') },
    });
    expect(raviSees.given).toHaveLength(0);
    expect((await asha.browser.get(`${P}/feedback`)).body.given).toHaveLength(1);
    const other = (await outsider.browser.get(`${P}/feedback`)).body;
    expect(other.received).toHaveLength(0);
    expect(other.given).toHaveLength(0);
  });

  it('cannot be edited or deleted', async () => {
    const runtime = createDatabaseClient({ connectionString: requireEnv('DATABASE_URL'), maxConnections: 1 });
    try {
      await expect(
        withTenant(runtime, tenantId, (tx) => tx.$executeRaw`DELETE FROM feedback_note`),
      ).rejects.toThrow();
    } finally {
      await runtime.$disconnect();
    }
  });
});

describe('plan gating', () => {
  it('is refused on a plan without performance', async () => {
    const tenant = await fx.tenant('PerfLite', 'ACTIVE', { plan: 'LITE' });
    const user = await fx.user('perflite-owner');
    await fx.member(tenant.id, user.id, true);
    const b = new Browser(app);
    expect((await b.login(user.email)).status).toBe(200);
    const res = await b.get(`${P}/cycles`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ENTITLEMENT_REQUIRED');
  });
});
