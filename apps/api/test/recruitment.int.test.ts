/**
 * Recruitment and onboarding through the real API and database: an opening approved before it takes
 * candidates, the pipeline with its history, interviews and blind feedback, an offer approved by people,
 * the hire making an employee record, and onboarding tasks for HR, the manager and the new joiner.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDatabaseClient, withTenant } from '@smart-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import { Browser, Fixtures, ownerClient, requireEnv, startApp, testEnv } from './helpers.js';

const db = ownerClient();
const runtime = createDatabaseClient({ connectionString: requireEnv('DATABASE_URL'), maxConnections: 2 });
const fx = new Fixtures(db);
const storageDir = mkdtempSync(join(tmpdir(), 'shr-recruit-'));
let app: NestExpressApplication;
let tenantId: string;
let ownerId: string;
let owner: Browser;
let acme: string;
let otherBranch: string;
let designation: string;

interface Person {
  employeeId: string;
  browser: Browser;
  membershipId: string;
  userId: string;
}

async function person(
  label: string,
  permissions?: string[],
  scope?: { type: 'BRANCH'; id: string },
): Promise<Person> {
  const user = await fx.user(label);
  const m = await fx.member(tenantId, user.id);
  if (permissions) {
    await fx.assign(
      tenantId,
      m.id,
      await fx.customRole(tenantId, label, permissions),
      scope ?? { type: 'TENANT', id: tenantId },
    );
  }
  const res = await owner.send('post', '/v1/employees', {
    firstName: label,
    lastName: 'Test',
    companyId: acme,
    dateOfJoining: '2025-01-01',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await db.employee.update({ where: { id: res.body.id }, data: { membershipId: m.id } });
  const browser = new Browser(app);
  expect((await browser.login(user.email)).status).toBe(200);
  return { employeeId: res.body.id as string, browser, membershipId: m.id, userId: user.id };
}

async function approve(approvalRequestId: string, decision: 'APPROVE' | 'REJECT' | 'RETURN' = 'APPROVE') {
  const inbox = (await owner.get('/v1/approvals/inbox')).body as { id: string; request: { id: string } }[];
  const task = inbox.find((t) => t.request.id === approvalRequestId);
  expect(task, 'owner has the approval task').toBeDefined();
  const res = await owner.send('post', `/v1/approvals/tasks/${task!.id}/decision`, {
    decision,
    ...(decision === 'APPROVE' ? {} : { comment: 'Not now' }),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

/** The first interview's feedback from someone other than me. */
const othersFeedback = (body: unknown) =>
  (body as { interviews: { feedback: { mine: boolean }[] }[] }).interviews[0]?.feedback.find((f) => !f.mine);

let recruiter: Person;
let interviewer: Person;
let manager: Person;
let branchRecruiter: Person;

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv({ STORAGE_LOCAL_DIR: storageDir }));
  const tenant = await fx.tenant('Recruitment');
  tenantId = tenant.id;
  const ownerUser = await fx.user('rec-owner');
  ownerId = ownerUser.id;
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  acme = (await fx.company(tenantId, 'ACME')).id;
  const branch = await owner.send('post', '/v1/org/branches', {
    companyId: acme,
    code: 'PUNE',
    name: 'Pune',
  });
  expect(branch.status, JSON.stringify(branch.body)).toBe(201);
  otherBranch = branch.body.id as string;
  const d = await owner.send('post', '/v1/master-data/designation', { code: 'NURSE', name: 'Staff nurse' });
  designation = d.body.id as string;
  recruiter = await person('rec-recruiter', [
    'recruitment.view',
    'recruitment.manage',
    'employees.view',
    'employees.manage',
    'onboarding.manage',
  ]);
  interviewer = await person('rec-interviewer');
  manager = await person('rec-manager');
  branchRecruiter = await person('rec-branch', ['recruitment.view', 'recruitment.manage'], {
    type: 'BRANCH',
    id: otherBranch,
  });
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await runtime.$disconnect();
  await db.$disconnect();
  rmSync(storageDir, { recursive: true, force: true });
});

let openingId: string;
let applicationId: string;

describe('openings', () => {
  it('are drafted, approved by people, and only then take candidates', async () => {
    const created = await recruiter.browser.send('post', '/v1/recruitment/openings', {
      title: 'Staff nurse, ICU',
      companyId: acme,
      designationId: designation,
      hiringManagerId: manager.employeeId,
      positions: 1,
      description: 'Night and day shifts in the intensive care unit.',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({
      code: 'JOB-0001',
      status: 'DRAFT',
      can: { submit: true, addCandidates: false },
    });
    openingId = created.body.id as string;

    const early = await recruiter.browser.send('post', `/v1/recruitment/openings/${openingId}/applications`, {
      firstName: 'Asha',
      lastName: 'Rao',
      email: 'asha@example.test',
    });
    expect(early.body.code).toBe('OPENING_NOT_OPEN');

    const submitted = await recruiter.browser.send('post', `/v1/recruitment/openings/${openingId}/submit`);
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(submitted.body.status).toBe('PENDING_APPROVAL');
    // Nobody approves their own request: the recruiter has no task; the owners do.
    const recruiterInbox = (await recruiter.browser.get('/v1/approvals/inbox')).body as unknown[];
    expect(recruiterInbox).toHaveLength(0);
    await approve(submitted.body.approvalRequestId as string);
    const opened = (await recruiter.browser.get(`/v1/recruitment/openings/${openingId}`)).body;
    expect(opened).toMatchObject({
      status: 'OPEN',
      can: { addCandidates: true },
      hiringManager: { id: manager.employeeId },
    });
    expect(opened.openedAt).not.toBeNull();
  });

  it('are seen only where the member recruits, or by their hiring manager', async () => {
    const theirs = (await branchRecruiter.browser.get('/v1/recruitment/openings')).body as { id: string }[];
    expect(theirs.map((o) => o.id)).not.toContain(openingId);
    expect((await branchRecruiter.browser.get(`/v1/recruitment/openings/${openingId}`)).status).toBe(404);
    expect((await interviewer.browser.get(`/v1/recruitment/openings/${openingId}`)).status).toBe(404);
    const mine = (await manager.browser.get('/v1/recruitment/openings')).body as {
      id: string;
      can: { manage: boolean };
    }[];
    expect(mine.map((o) => o.id)).toEqual([openingId]);
    expect(mine[0]?.can.manage).toBe(false);
    // A branch recruiter can't open a position outside their branch.
    const outside = await branchRecruiter.browser.send('post', '/v1/recruitment/openings', {
      title: 'Ward clerk',
      companyId: acme,
      description: 'Front desk of the general ward.',
    });
    expect(outside.status).toBe(403);
    const inside = await branchRecruiter.browser.send('post', '/v1/recruitment/openings', {
      title: 'Ward clerk',
      companyId: acme,
      branchId: otherBranch,
      description: 'Front desk of the general ward.',
    });
    expect(inside.status, JSON.stringify(inside.body)).toBe(201);
    expect(inside.body.code).toBe('JOB-0002');
  });
});

describe('candidates', () => {
  it('are added once per opening with their résumé, and moved through stages with history', async () => {
    let req = recruiter.browser.agent
      .post(`/v1/recruitment/openings/${openingId}/applications`)
      .set('Origin', 'http://localhost:3000')
      .set('x-csrf-token', recruiter.browser.csrf!)
      .attach('resume', Buffer.from('%PDF-1.4 résumé'), 'asha-cv.pdf');
    for (const [k, v] of Object.entries({
      firstName: 'Asha',
      lastName: 'Rao',
      email: 'Asha@Example.test',
      source: 'Referral',
    }))
      req = req.field(k, v);
    const added = await req;
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(added.body).toMatchObject({
      stage: 'APPLIED',
      candidate: { name: 'Asha Rao', email: 'asha@example.test', resume: { name: 'asha-cv.pdf' } },
    });
    applicationId = added.body.id as string;

    const again = await recruiter.browser.send('post', `/v1/recruitment/openings/${openingId}/applications`, {
      firstName: 'Asha',
      lastName: 'Rao',
      email: 'asha@example.test',
    });
    expect(again.body.code).toBe('ALREADY_APPLIED');
    expect(await db.candidate.count({ where: { tenantId } })).toBe(1);

    const badResume = await recruiter.browser.agent
      .post(`/v1/recruitment/openings/${openingId}/applications`)
      .set('Origin', 'http://localhost:3000')
      .set('x-csrf-token', recruiter.browser.csrf!)
      .attach('resume', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'photo.png')
      .field('firstName', 'Ravi')
      .field('lastName', 'K')
      .field('email', 'ravi@example.test');
    expect(badResume.body.code).toBe('FILE_TYPE_NOT_ALLOWED');

    const moved = await recruiter.browser.send(
      'post',
      `/v1/recruitment/applications/${applicationId}/stage`,
      {
        stage: 'SCREENING',
        note: 'Good ICU experience',
      },
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect((moved.body as { events: { toStage: string }[] }).events.map((e) => e.toStage)).toEqual([
      'APPLIED',
      'SCREENING',
    ]);
    const reject = await recruiter.browser.send(
      'post',
      `/v1/recruitment/applications/${applicationId}/stage`,
      {
        stage: 'REJECTED',
      },
    );
    expect(reject.status).toBe(400);
    expect(
      (
        await manager.browser.send('post', `/v1/recruitment/applications/${applicationId}/stage`, {
          stage: 'APPLIED',
        })
      ).status,
    ).toBe(403);
    const resume = await recruiter.browser.get(`/v1/recruitment/applications/${applicationId}/resume`);
    expect(resume.status).toBe(200);
    expect(resume.headers['content-disposition']).toContain('asha-cv.pdf');
  });
});

describe('interviews', () => {
  let interviewId: string;

  it('tell the interviewers, who give blind feedback that is then final', async () => {
    const scheduled = await recruiter.browser.send(
      'post',
      `/v1/recruitment/applications/${applicationId}/interviews`,
      {
        title: 'Clinical round',
        scheduledAt: '2026-11-02T10:00:00+05:30',
        location: 'Room 4',
        interviewerMembershipIds: [interviewer.membershipId, manager.membershipId],
      },
    );
    expect(scheduled.status, JSON.stringify(scheduled.body)).toBe(201);
    expect(scheduled.body.stage).toBe('INTERVIEW');
    interviewId = scheduled.body.interviews[0].id as string;
    const notice = await db.notification.findFirst({
      where: { tenantId, recipientUserId: interviewer.userId, category: 'recruitment.interview' },
    });
    expect(notice?.title).toContain('Asha Rao');

    // The interviewer, who can't otherwise see recruitment, sees this application and their interview.
    const mine = (await interviewer.browser.get('/v1/recruitment/interviews/mine')).body as {
      interviewId: string;
      feedbackDue: boolean;
    }[];
    expect(mine).toEqual([expect.objectContaining({ interviewId, feedbackDue: true })]);
    expect((await interviewer.browser.get(`/v1/recruitment/applications/${applicationId}`)).status).toBe(200);
    expect((await interviewer.browser.get(`/v1/recruitment/openings/${openingId}`)).status).toBe(404);

    const managerFeedback = await manager.browser.send(
      'post',
      `/v1/recruitment/interviews/${interviewId}/feedback`,
      {
        rating: 4,
        recommendation: 'YES',
        comments: 'Calm under pressure, strong on protocols.',
      },
    );
    expect(managerFeedback.status, JSON.stringify(managerFeedback.body)).toBe(200);
    // Until they give their own, the interviewer can't see what the manager said.
    const blind = (await interviewer.browser.get(`/v1/recruitment/applications/${applicationId}`)).body;
    const theirView = othersFeedback(blind);
    expect(theirView).toMatchObject({ submitted: true, rating: null, comments: null });

    const own = await interviewer.browser.send('post', `/v1/recruitment/interviews/${interviewId}/feedback`, {
      rating: 5,
      recommendation: 'STRONG_YES',
      comments: 'Best candidate this quarter.',
    });
    expect(own.status).toBe(200);
    expect(othersFeedback(own.body)).toMatchObject({
      rating: 4,
    });
    const twice = await interviewer.browser.send(
      'post',
      `/v1/recruitment/interviews/${interviewId}/feedback`,
      {
        rating: 1,
        recommendation: 'NO',
        comments: 'Changing my mind now.',
      },
    );
    expect(twice.body.code).toBe('FEEDBACK_SUBMITTED');
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.interviewFeedback.updateMany({ where: { interviewId }, data: { comments: 'rewritten' } }),
      ),
    ).rejects.toThrow(/already submitted/);
  });
});

describe('offers and hiring', () => {
  let offerId: string;

  it('go to people for approval, and only an accepted offer can be hired', async () => {
    const res = await recruiter.browser.send('post', `/v1/recruitment/applications/${applicationId}/offers`, {
      joiningDate: '2026-12-01',
      annualCtc: 720000,
      notes: 'Night allowance extra',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.stage).toBe('OFFER');
    expect(res.body.offers[0]).toMatchObject({
      status: 'PENDING_APPROVAL',
      annualCtc: 720000,
      currency: 'INR',
    });
    offerId = res.body.offers[0].id as string;
    const request = await db.approvalRequest.findUniqueOrThrow({
      where: { id: res.body.offers[0].approvalRequestId },
    });
    expect(request).toMatchObject({ subjectType: 'job_offer', currency: 'INR' });
    expect(Number(request.amount)).toBe(720000);

    expect(
      (
        await recruiter.browser.send('post', `/v1/recruitment/applications/${applicationId}/offers`, {
          joiningDate: '2026-12-01',
        })
      ).body.code,
    ).toBe('OFFER_OPEN');
    const tooEarly = await recruiter.browser.send('post', `/v1/recruitment/offers/${offerId}/response`, {
      response: 'ACCEPTED',
    });
    expect(tooEarly.body.code).toBe('OFFER_NOT_APPROVED');
    const hireEarly = await recruiter.browser.send(
      'post',
      `/v1/recruitment/applications/${applicationId}/hire`,
      {},
    );
    expect(hireEarly.body.code).toBe('NOT_READY_TO_HIRE');

    // The approver sees the offer they are deciding.
    expect((await owner.get(`/v1/recruitment/offers/${offerId}`)).body).toMatchObject({
      candidate: { name: 'Asha Rao' },
    });
    await approve(request.id);
    const accepted = await recruiter.browser.send('post', `/v1/recruitment/offers/${offerId}/response`, {
      response: 'ACCEPTED',
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.offers[0].status).toBe('ACCEPTED');
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.jobOffer.update({ where: { id: offerId }, data: { status: 'DECLINED' } }),
      ),
    ).rejects.toThrow(/already accepted/);
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.jobOffer.update({ where: { id: offerId }, data: { notes: 'More money' } }),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('makes the employee record, closes the filled opening and starts onboarding', async () => {
    const template = await recruiter.browser.send('post', '/v1/onboarding/templates', {
      name: 'Clinical staff',
      tasks: [
        { title: 'Prepare locker and uniform', assignee: 'HR', dueOffsetDays: -2 },
        { title: 'Ward orientation', assignee: 'MANAGER', dueOffsetDays: 1 },
        { title: 'Upload nursing licence', assignee: 'EMPLOYEE', dueOffsetDays: 3 },
      ],
    });
    expect(template.status, JSON.stringify(template.body)).toBe(201);
    const hired = await recruiter.browser.send('post', `/v1/recruitment/applications/${applicationId}/hire`, {
      workEmail: 'asha.rao@acme.test',
      onboardingTemplateId: template.body.id,
    });
    expect(hired.status, JSON.stringify(hired.body)).toBe(200);
    expect(hired.body.application).toMatchObject({ stage: 'HIRED' });
    const employee = hired.body.employee as { id: string; dateOfJoining: string; manager: { id: string } };
    expect(employee).toMatchObject({
      firstName: 'Asha',
      personalEmail: 'asha@example.test',
      workEmail: 'asha.rao@acme.test',
      dateOfJoining: '2026-12-01',
      designation: { name: 'Staff nurse' },
      manager: { id: manager.employeeId },
    });
    expect((await recruiter.browser.get(`/v1/recruitment/openings/${openingId}`)).body.status).toBe('CLOSED');
    const resumeDoc = await db.employeeDocument.findFirstOrThrow({ where: { employeeId: employee.id } });
    expect(resumeDoc).toMatchObject({ category: 'EMPLOYMENT', visibleToEmployee: false });
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.jobApplication.update({
          where: { id: applicationId },
          data: { stage: 'OFFER', hiredEmployeeId: null },
        }),
      ),
    ).rejects.toThrow(/already hired/);

    const plan = (await recruiter.browser.get(`/v1/onboarding/employees/${employee.id}`)).body;
    expect(plan.plans).toHaveLength(1);
    const tasks = plan.plans[0].tasks as {
      id: string;
      title: string;
      dueDate: string;
      assigneeName: string;
    }[];
    expect(tasks.map((t) => t.dueDate)).toEqual(['2026-11-29', '2026-12-02', '2026-12-04']);
    // The joiner has no sign-in yet, so their task falls to HR; the manager's goes to the manager.
    expect(tasks.map((t) => t.assigneeName)).toEqual(['rec-recruiter', 'rec-manager', 'rec-recruiter']);

    const managerTasks = (await manager.browser.get('/v1/onboarding/tasks/mine')).body as {
      id: string;
      employee: { name: string };
    }[];
    expect(managerTasks).toHaveLength(1);
    expect(managerTasks[0]?.employee.name).toBe('Asha Rao');
    expect((await manager.browser.get(`/v1/onboarding/employees/${employee.id}`)).status).toBe(200);
    expect((await interviewer.browser.get(`/v1/onboarding/employees/${employee.id}`)).status).toBe(404);
    expect(
      (
        await interviewer.browser.send('post', `/v1/onboarding/tasks/${managerTasks[0]!.id}`, {
          status: 'DONE',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await manager.browser.send('post', `/v1/onboarding/tasks/${managerTasks[0]!.id}`, {
          status: 'SKIPPED',
        })
      ).status,
    ).toBe(403);
    const done = await manager.browser.send('post', `/v1/onboarding/tasks/${managerTasks[0]!.id}`, {
      status: 'DONE',
      note: 'Toured both wards',
    });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.progress).toEqual({ done: 1, total: 3 });

    for (const t of tasks.filter((x) => x.assigneeName === 'rec-recruiter')) {
      await recruiter.browser.send('post', `/v1/onboarding/tasks/${t.id}`, { status: 'DONE' });
    }
    const finished = (await recruiter.browser.get(`/v1/onboarding/employees/${employee.id}`)).body.plans[0];
    expect(finished.status).toBe('COMPLETED');
    const again = await recruiter.browser.send('post', `/v1/onboarding/employees/${employee.id}`, {
      templateId: template.body.id,
    });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(
      (
        await recruiter.browser.send('post', `/v1/onboarding/employees/${employee.id}`, {
          templateId: template.body.id,
        })
      ).body.code,
    ).toBe('ONBOARDING_ACTIVE');
  });

  it('withdraws an offer still out when the candidate is rejected', async () => {
    const second = await db.jobOpening.create({
      data: {
        tenantId,
        code: 'JOB-9001',
        title: 'Pharmacist',
        companyId: acme,
        description: 'Hospital pharmacy.',
        status: 'OPEN',
        createdByUserId: ownerId,
      },
    });
    const added = await recruiter.browser.send('post', `/v1/recruitment/openings/${second.id}/applications`, {
      firstName: 'Ravi',
      lastName: 'Kumar',
      email: 'ravi@example.test',
    });
    const offer = await recruiter.browser.send(
      'post',
      `/v1/recruitment/applications/${added.body.id}/offers`,
      { joiningDate: '2027-01-04' },
    );
    expect(offer.status).toBe(201);
    const rejected = await recruiter.browser.send(
      'post',
      `/v1/recruitment/applications/${added.body.id}/stage`,
      {
        stage: 'REJECTED',
        note: 'Failed reference check',
      },
    );
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    expect(rejected.body.offers[0].status).toBe('CANCELLED');
    const request = await db.approvalRequest.findUniqueOrThrow({
      where: { id: offer.body.offers[0].approvalRequestId },
    });
    expect(request.status).toBe('CANCELLED');
    expect(
      (
        await recruiter.browser.send('post', `/v1/recruitment/applications/${added.body.id}/stage`, {
          stage: 'SCREENING',
        })
      ).body.code,
    ).toBe('APPLICATION_CLOSED');
  });

  it('needs recruitment in the plan', async () => {
    await db.entitlementOverride.create({
      data: {
        tenantId,
        kind: 'FEATURE',
        key: 'recruitment',
        enabled: false,
        reason: 'test',
        createdByUserId: ownerId,
      },
    });
    try {
      const res = await recruiter.browser.get('/v1/recruitment/openings');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ENTITLEMENT_REQUIRED');
    } finally {
      await db.entitlementOverride.deleteMany({ where: { tenantId, key: 'recruitment' } });
    }
  });
});
