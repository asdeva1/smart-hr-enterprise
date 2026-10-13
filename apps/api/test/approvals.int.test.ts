/**
 * The approval engine and notifications through the real API, database (as app_rw, under RLS) and Redis.
 * Modules submit requests from inside their own transactions; the tests do the same through the engine,
 * then act as approvers over HTTP. A recording subject handler stands in for a module.
 */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { withContext, type ApprovalRequest, type DatabaseClient } from '@smart-hr/database';
import type { ApprovalPolicyDefinition } from '@smart-hr/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApprovalEngine, type SubmitInput } from '../src/approvals/approval.engine.js';
import { ApprovalSubjectRegistry } from '../src/approvals/approval-subjects.js';
import { DATABASE } from '../src/infra/tokens.js';
import { Browser, Fixtures, ownerClient, startApp, testEnv } from './helpers.js';

let app: NestExpressApplication;
let engine: ApprovalEngine;
let appDb: DatabaseClient;
const db = ownerClient();
const fx = new Fixtures(db);
const SUBJECT = 'expense_claim';
const events: { kind: string; subjectId: string; comment?: string | null }[] = [];
const meta = { ip: null, userAgent: null, requestId: null };
/** Subject ids whose first approval should hold its transaction open for a while, to force a race. */
const slowApprovals = new Set<string>();

beforeAll(async () => {
  app = await startApp(testEnv());
  engine = app.get(ApprovalEngine);
  appDb = app.get(DATABASE);
  const record =
    (kind: string) =>
    async (_tx: unknown, r: ApprovalRequest, comment?: string | null): Promise<void> => {
      events.push({ kind, subjectId: r.subjectId, comment: comment ?? null });
      if (kind === 'approved' && slowApprovals.delete(r.subjectId)) {
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    };
  app.get(ApprovalSubjectRegistry).register(SUBJECT, {
    onApproved: record('approved'),
    onRejected: record('rejected'),
    onReturned: record('returned'),
    onCancelled: record('cancelled'),
  });
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await db.$disconnect();
});

const eventsFor = (subjectId: string) => events.filter((e) => e.subjectId === subjectId).map((e) => e.kind);

interface Person {
  user: { id: string; email: string };
  membership: { id: string };
  browser: Browser;
  label: string;
}

async function organisation(name: string) {
  const tenant = await fx.tenant(name);

  async function person(label: string, options: { owner?: boolean; roles?: string[] } = {}): Promise<Person> {
    const user = await fx.user(`${name}-${label}`);
    const membership = await fx.member(tenant.id, user.id, options.owner ?? false);
    for (const roleId of options.roles ?? []) await fx.assign(tenant.id, membership.id, roleId);
    const browser = new Browser(app);
    expect((await browser.login(user.email)).status).toBe(200);
    return { user, membership, browser, label };
  }

  const owner = await person('owner', { owner: true });

  /** Submits as a module would: inside a tenant transaction, as the requester. */
  async function submit(requester: Person, input: Partial<SubmitInput> = {}): Promise<ApprovalRequest> {
    return withContext(appDb, { tenantId: tenant.id, userId: requester.user.id }, (tx) =>
      engine.submit(
        tx,
        {
          tenantId: tenant.id,
          membershipId: requester.membership.id,
          userId: requester.user.id,
          displayName: requester.label,
        },
        {
          subjectType: SUBJECT,
          subjectId: randomUUID(),
          title: `Claim by ${requester.label}`,
          scope: { type: 'TENANT', id: tenant.id },
          ...input,
        },
        meta,
      ),
    );
  }

  async function policy(
    definition: Partial<ApprovalPolicyDefinition> & Pick<ApprovalPolicyDefinition, 'stages'>,
  ) {
    const res = await owner.browser.send('post', '/v1/approvals/policies', {
      subjectType: SUBJECT,
      name: 'Expense approvals',
      definition,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: string; version: number };
  }

  return { tenant, owner, person, submit, policy };
}

/** The pending task for this person on this request (from their inbox). */
async function taskOf(person: Person, requestId: string): Promise<string | undefined> {
  const inbox = await person.browser.get('/v1/approvals/inbox');
  expect(inbox.status).toBe(200);
  return (inbox.body as { id: string; request: { id: string } }[]).find((t) => t.request.id === requestId)
    ?.id;
}

async function decide(
  person: Person,
  requestId: string,
  decision: 'APPROVE' | 'REJECT' | 'RETURN',
  comment?: string,
) {
  const taskId = await taskOf(person, requestId);
  expect(taskId, `${person.label} should have a task`).toBeDefined();
  return person.browser.send('post', `/v1/approvals/tasks/${taskId}/decision`, { decision, comment });
}

describe('default policy', () => {
  it('sends a request to the owners, records the decision and tells the requester', async () => {
    const org = await organisation('Dflt');
    const asha = await org.person('asha');
    const request = await org.submit(asha);
    expect(request.status).toBe('PENDING');

    // The requester sees it as theirs, but has nothing to decide.
    expect(await taskOf(asha, request.id)).toBeUndefined();
    const mine = await asha.browser.get('/v1/approvals/requests');
    expect((mine.body as { id: string }[]).map((r) => r.id)).toContain(request.id);

    const approve = await decide(org.owner, request.id, 'APPROVE');
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('APPROVED');
    expect(eventsFor(request.subjectId)).toEqual(['approved']);

    const detail = await asha.browser.get(`/v1/approvals/requests/${request.id}`);
    expect(detail.body).toMatchObject({ status: 'APPROVED', isMine: true, policy: { version: 1 } });
    expect(detail.body.tasks).toEqual([
      expect.objectContaining({ status: 'APPROVED', assignee: 'Dflt-owner' }),
    ]);

    const notes = await asha.browser.get('/v1/notifications');
    expect(notes.body.unread).toBe(1);
    expect(notes.body.items[0]).toMatchObject({
      category: 'approval.decided',
      link: `/approvals/${request.id}`,
    });
  });

  it('refuses a second decision on the same task', async () => {
    const org = await organisation('Twice');
    const asha = await org.person('asha');
    const request = await org.submit(asha);
    const taskId = await taskOf(org.owner, request.id);
    const url = `/v1/approvals/tasks/${taskId}/decision`;
    expect((await org.owner.browser.send('post', url, { decision: 'APPROVE' })).status).toBe(200);
    const again = await org.owner.browser.send('post', url, {
      decision: 'REJECT',
      comment: 'changed my mind',
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('TASK_ALREADY_DECIDED');
  });

  it('fails clearly when nobody but the requester could approve', async () => {
    const org = await organisation('Solo');
    await expect(org.submit(org.owner)).rejects.toMatchObject({ code: 'NO_APPROVER' });
  });
});

describe('policies', () => {
  it('skips stages below their amount threshold and needs every approver in an ALL stage', async () => {
    const org = await organisation('Stages');
    const finance = await fx.customRole(org.tenant.id, 'Finance', []);
    const manager = await org.person('manager');
    const f1 = await org.person('f1', { roles: [finance] });
    const f2 = await org.person('f2', { roles: [finance] });
    const asha = await org.person('asha');
    await org.policy({
      stages: [
        {
          name: 'Manager',
          mode: 'ANY',
          approvers: [{ type: 'MEMBER', membershipId: manager.membership.id }],
        },
        { name: 'Finance', mode: 'ALL', approvers: [{ type: 'ROLE', roleId: finance }], minAmount: '50000' },
      ],
    });

    const small = await org.submit(asha, { amount: '1200.50', currency: 'INR' });
    expect((await decide(manager, small.id, 'APPROVE')).body.status).toBe('APPROVED');
    expect(await taskOf(f1, small.id)).toBeUndefined();

    const large = await org.submit(asha, { amount: '75000', currency: 'INR' });
    expect((await decide(manager, large.id, 'APPROVE')).body.status).toBe('PENDING');
    expect((await decide(f1, large.id, 'APPROVE')).body.status).toBe('PENDING');
    expect(eventsFor(large.subjectId)).toEqual([]);
    expect((await decide(f2, large.id, 'APPROVE')).body.status).toBe('APPROVED');
    expect(eventsFor(large.subjectId)).toEqual(['approved']);

    const detail = await asha.browser.get(`/v1/approvals/requests/${large.id}`);
    expect(detail.body.amount).toBe('75000.00');
    expect(detail.body.stages).toEqual([
      { name: 'Manager', mode: 'ANY', minAmount: null },
      { name: 'Finance', mode: 'ALL', minAmount: '50000' },
    ]);
  });

  it('never assigns requesters to their own request, nor one person to two stages', async () => {
    const org = await organisation('Sod');
    const finance = await fx.customRole(org.tenant.id, 'Finance', []);
    const lead = await org.person('lead', { roles: [finance] });
    const other = await org.person('other', { roles: [finance] });
    await org.policy({
      stages: [
        { name: 'Finance check', mode: 'ANY', approvers: [{ type: 'ROLE', roleId: finance }] },
        { name: 'Finance sign-off', mode: 'ANY', approvers: [{ type: 'ROLE', roleId: finance }] },
      ],
    });

    // The lead holds the role but asked: only the other finance member is assigned.
    const own = await org.submit(lead);
    expect(await taskOf(lead, own.id)).toBeUndefined();
    expect(await taskOf(other, own.id)).toBeDefined();

    // Whoever approves stage 1 is excluded from stage 2.
    const asha = await org.person('asha');
    const request = await org.submit(asha);
    expect((await decide(lead, request.id, 'APPROVE')).body.status).toBe('PENDING');
    expect(await taskOf(lead, request.id)).toBeUndefined();
    expect((await decide(other, request.id, 'APPROVE')).body.status).toBe('APPROVED');
  });

  it('keeps in-flight requests on the version they started with', async () => {
    const org = await organisation('Versions');
    const manager = await org.person('manager');
    const asha = await org.person('asha');
    const before = await org.submit(asha); // default policy (v1): owners
    const v2 = await org.policy({
      stages: [
        {
          name: 'Manager',
          mode: 'ANY',
          approvers: [{ type: 'MEMBER', membershipId: manager.membership.id }],
        },
      ],
    });
    expect(v2.version).toBe(2);
    const after = await org.submit(asha);

    expect(await taskOf(org.owner, before.id)).toBeDefined();
    expect(await taskOf(manager, before.id)).toBeUndefined();
    expect(await taskOf(manager, after.id)).toBeDefined();

    const list = await org.owner.browser.get('/v1/approvals/policies');
    const expense = (
      list.body as { subjectType: string; active: { version: number }; versions: number }[]
    ).find((p) => p.subjectType === SUBJECT);
    expect(expense).toMatchObject({ active: { version: 2 }, versions: 2 });
  });

  it('validates references and who may publish', async () => {
    const org = await organisation('PolicyRules');
    const elsewhere = await organisation('PolicyOther');
    const foreignRole = await fx.customRole(elsewhere.tenant.id, 'Foreign', []);
    const bad = await org.owner.browser.send('post', '/v1/approvals/policies', {
      subjectType: SUBJECT,
      name: 'Uses another organisation’s role',
      definition: {
        stages: [{ name: 'X stage', mode: 'ANY', approvers: [{ type: 'ROLE', roleId: foreignRole }] }],
      },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('UNKNOWN_ROLE');

    const noAmount = await org.owner.browser.send('post', '/v1/approvals/policies', {
      subjectType: 'workspace_change',
      name: 'Threshold on a subject without amounts',
      definition: {
        stages: [{ name: 'Owners', mode: 'ANY', approvers: [{ type: 'OWNERS' }], minAmount: '10' }],
      },
    });
    expect(noAmount.body.code).toBe('NO_AMOUNT');

    const unknown = await org.owner.browser.send('post', '/v1/approvals/policies', {
      subjectType: 'made_up',
      name: 'Nope nope',
      definition: { stages: [{ name: 'Owners', mode: 'ANY', approvers: [{ type: 'OWNERS' }] }] },
    });
    expect(unknown.body.code).toBe('UNKNOWN_SUBJECT');

    const member = await org.person('member');
    expect((await member.browser.get('/v1/approvals/policies')).status).toBe(403);
  });
});

describe('reject, return, resubmit and cancel', () => {
  it('needs a reason to reject, and closes the other approvers’ tasks', async () => {
    const org = await organisation('Reject');
    const coOwner = await org.person('coowner', { owner: true });
    const asha = await org.person('asha');
    const request = await org.submit(asha);

    const silent = await decide(org.owner, request.id, 'REJECT');
    expect(silent.status).toBe(400);

    const rejected = await decide(org.owner, request.id, 'REJECT', 'Receipts missing');
    expect(rejected.body.status).toBe('REJECTED');
    expect(events.find((e) => e.subjectId === request.subjectId)).toMatchObject({
      comment: 'Receipts missing',
    });
    expect(await taskOf(coOwner, request.id)).toBeUndefined();

    const detail = await asha.browser.get(`/v1/approvals/requests/${request.id}`);
    expect((detail.body.tasks as { status: string }[]).map((t) => t.status).sort()).toEqual([
      'CANCELLED',
      'REJECTED',
    ]);
  });

  it('lets the requester fix and resubmit a returned request, or withdraw it', async () => {
    const org = await organisation('Return');
    const asha = await org.person('asha');
    const request = await org.submit(asha);
    expect((await decide(org.owner, request.id, 'RETURN', 'Add the hotel bill')).body.status).toBe(
      'RETURNED',
    );

    // Only the requester can resubmit.
    const stranger = await org.person('stranger');
    expect(
      (await stranger.browser.send('post', `/v1/approvals/requests/${request.id}/resubmit`)).status,
    ).toBe(404);

    const again = await asha.browser.send('post', `/v1/approvals/requests/${request.id}/resubmit`);
    expect(again.body.status).toBe('PENDING');
    const detail = await asha.browser.get(`/v1/approvals/requests/${request.id}`);
    expect(detail.body.round).toBe(2);

    const cancel = await asha.browser.send('post', `/v1/approvals/requests/${request.id}/cancel`);
    expect(cancel.body.status).toBe('CANCELLED');
    expect(eventsFor(request.subjectId)).toEqual(['returned', 'cancelled']);
    expect(await taskOf(org.owner, request.id)).toBeUndefined();
    expect((await asha.browser.send('post', `/v1/approvals/requests/${request.id}/cancel`)).status).toBe(409);
  });
});

describe('delegation', () => {
  it('routes new tasks to the delegate while the approver is away, and stops when revoked', async () => {
    const org = await organisation('Deleg');
    const manager = await org.person('manager');
    const deputy = await org.person('deputy');
    const asha = await org.person('asha');
    await org.policy({
      stages: [
        {
          name: 'Manager',
          mode: 'ANY',
          approvers: [{ type: 'MEMBER', membershipId: manager.membership.id }],
        },
      ],
    });

    const now = Date.now();
    const created = await manager.browser.send('post', '/v1/approvals/delegations', {
      toMembershipId: deputy.membership.id,
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + 86_400_000).toISOString(),
      reason: 'On leave',
    });
    expect(created.status).toBe(201);
    const received = await deputy.browser.get('/v1/approvals/delegations');
    expect(received.body).toEqual([
      expect.objectContaining({ direction: 'received', from: 'Deleg-manager' }),
    ]);

    const request = await org.submit(asha);
    expect(await taskOf(manager, request.id)).toBeUndefined();
    const inbox = await deputy.browser.get('/v1/approvals/inbox');
    expect(inbox.body[0]).toMatchObject({ request: { id: request.id } });
    expect(inbox.body[0].delegatedFromMembershipId).toBe(manager.membership.id);
    expect((await decide(deputy, request.id, 'APPROVE')).body.status).toBe('APPROVED');

    // A delegate can't approve their own request on the approver's behalf.
    const deputysOwn = await org.submit(deputy);
    expect(await taskOf(manager, deputysOwn.id)).toBeDefined();

    // Only the person who gave a delegation can end it.
    expect((await deputy.browser.send('delete', `/v1/approvals/delegations/${created.body.id}`)).status).toBe(
      404,
    );
    expect(
      (await manager.browser.send('delete', `/v1/approvals/delegations/${created.body.id}`)).status,
    ).toBe(204);
    const later = await org.submit(asha);
    expect(await taskOf(manager, later.id)).toBeDefined();
  });

  it('refuses delegating to yourself or to someone outside the organisation', async () => {
    const org = await organisation('DelegBad');
    const other = await organisation('DelegElse');
    const start = new Date().toISOString();
    const end = new Date(Date.now() + 3_600_000).toISOString();
    const self = await org.owner.browser.send('post', '/v1/approvals/delegations', {
      toMembershipId: org.owner.membership.id,
      startsAt: start,
      endsAt: end,
    });
    expect(self.body.code).toBe('DELEGATE_SELF');
    const foreign = await org.owner.browser.send('post', '/v1/approvals/delegations', {
      toMembershipId: other.owner.membership.id,
      startsAt: start,
      endsAt: end,
    });
    expect(foreign.status).toBe(404);

    // The picker lists colleagues by name only, never people from another organisation.
    const asha = await org.person('asha');
    const picker = await asha.browser.get('/v1/approvals/colleagues?search=owner');
    expect(picker.body).toEqual([{ membershipId: org.owner.membership.id, displayName: 'DelegBad-owner' }]);
    const all = await asha.browser.get('/v1/approvals/colleagues');
    expect((all.body as { membershipId: string }[]).map((c) => c.membershipId)).not.toContain(
      other.owner.membership.id,
    );
  });
});

describe('concurrency', () => {
  it('lets only one of two simultaneous approvers decide an ANY stage', async () => {
    const org = await organisation('Race');
    const second = await org.person('second', { owner: true });
    const asha = await org.person('asha');
    const request = await org.submit(asha);
    const [t1, t2] = [await taskOf(org.owner, request.id), await taskOf(second, request.id)];

    // The first approval keeps its transaction open, so the second arrives while it is still in flight.
    slowApprovals.add(request.subjectId);
    const first = org.owner.browser.send('post', `/v1/approvals/tasks/${t1}/decision`, {
      decision: 'APPROVE',
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const results = await Promise.all([
      first,
      second.browser.send('post', `/v1/approvals/tasks/${t2}/decision`, { decision: 'APPROVE' }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 409]);
    expect(eventsFor(request.subjectId)).toEqual(['approved']);
  });
});

describe('visibility', () => {
  it('hides requests from uninvolved members and other organisations, but not from auditors', async () => {
    const org = await organisation('Seen');
    const other = await organisation('Unseen');
    const asha = await org.person('asha');
    const bystander = await org.person('bystander');
    const auditor = await org.person('auditor', { roles: [await fx.systemRole(org.tenant.id, 'auditor')] });
    const request = await org.submit(asha);
    const taskId = await taskOf(org.owner, request.id);

    expect((await bystander.browser.get(`/v1/approvals/requests/${request.id}`)).status).toBe(404);
    expect((await bystander.browser.get('/v1/approvals/requests?view=all')).status).toBe(403);
    expect((await other.owner.browser.get(`/v1/approvals/requests/${request.id}`)).status).toBe(404);
    const foreignDecision = await other.owner.browser.send('post', `/v1/approvals/tasks/${taskId}/decision`, {
      decision: 'APPROVE',
    });
    expect(foreignDecision.status).toBe(404);
    // Someone else's task in the same organisation looks missing too.
    const stolen = await bystander.browser.send('post', `/v1/approvals/tasks/${taskId}/decision`, {
      decision: 'APPROVE',
    });
    expect(stolen.status).toBe(404);

    expect((await auditor.browser.get(`/v1/approvals/requests/${request.id}`)).status).toBe(200);
    const all = await auditor.browser.get('/v1/approvals/requests?view=all');
    expect((all.body as { id: string }[]).map((r) => r.id)).toContain(request.id);
    const otherAll = await other.owner.browser.get('/v1/approvals/requests?view=all');
    expect((otherAll.body as { id: string }[]).map((r) => r.id)).not.toContain(request.id);
  });
});

describe('notifications', () => {
  it('writes in-app notifications only their recipient can see or mark read', async () => {
    const org = await organisation('Notes');
    const asha = await org.person('asha');
    const request = await org.submit(asha);

    const ownerNotes = await org.owner.browser.get('/v1/notifications');
    const assigned = (ownerNotes.body.items as { id: string; category: string }[]).find(
      (n) => n.category === 'approval.assigned',
    );
    expect(assigned).toMatchObject({ category: 'approval.assigned' });
    expect((await asha.browser.get('/v1/notifications')).body.items).toEqual([]);
    expect((await asha.browser.send('post', `/v1/notifications/${assigned!.id}/read`)).status).toBe(404);

    expect((await org.owner.browser.send('post', `/v1/notifications/${assigned!.id}/read`)).status).toBe(204);
    expect((await org.owner.browser.get('/v1/notifications?unread=true')).body.items).toEqual([]);

    // Email follows the category default until the person turns it off.
    const row = await db.notification.findUniqueOrThrow({ where: { id: assigned!.id } });
    expect(row).toMatchObject({ emailStatus: 'PENDING', emailTo: org.owner.user.email });

    const off = await org.owner.browser.send('put', '/v1/notifications/preferences', {
      category: 'approval.assigned',
      emailEnabled: false,
    });
    expect(off.status).toBe(200);
    await decide(org.owner, request.id, 'APPROVE');
    await org.submit(asha);
    const latest = await db.notification.findFirstOrThrow({
      where: { tenantId: org.tenant.id, recipientUserId: org.owner.user.id, category: 'approval.assigned' },
      orderBy: { createdAt: 'desc' },
    });
    expect(latest.emailStatus).toBe('NOT_REQUESTED');

    const prefs = await org.owner.browser.get('/v1/notifications/preferences');
    expect(prefs.body).toContainEqual(
      expect.objectContaining({ category: 'approval.assigned', emailEnabled: false }),
    );
    const unknown = await org.owner.browser.send('put', '/v1/notifications/preferences', {
      category: 'made.up',
      emailEnabled: true,
    });
    expect(unknown.status).toBe(400);
  });

  it('marks everything read in one go, for the caller only', async () => {
    const org = await organisation('ReadAll');
    const coOwner = await org.person('coowner', { owner: true });
    const asha = await org.person('asha');
    await org.submit(asha);
    await org.submit(asha);
    const res = await org.owner.browser.send('post', '/v1/notifications/read-all');
    expect(res.body.marked).toBe(2);
    expect((await coOwner.browser.get('/v1/notifications')).body.unread).toBe(2);
  });
});
