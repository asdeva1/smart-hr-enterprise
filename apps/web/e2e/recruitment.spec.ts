/**
 * Recruitment end to end: an owner drafts an opening and sends it for approval; a named approver approves it;
 * the owner adds a candidate with a résumé, schedules an interview with the approver, who gives feedback and
 * approves the offer; the owner records the acceptance and hires, which makes the employee record and starts
 * the onboarding checklist made through the screens.
 */
import { expect, test, type Page } from '@playwright/test';
import { account, signIn, waitForEmail } from './support';

test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).toUpperCase();
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const approverEmail = `hiring-${run.toLowerCase()}@e2e.smarthr.test`;
const approverPassword = `Copper meadow lantern ${run}`;
const jobTitle = `Staff nurse ${run}`;
const checklist = `Clinical joiners ${run}`;
const candidate = `Divya Nair${run}`;
let openingUrl = '';
let applicationUrl = '';

async function signInAsOwner(page: Page) {
  const admin = account('ADMIN');
  await signIn(page, admin.email, admin.password);
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
}

async function signInAsApprover(page: Page) {
  await signIn(page, approverEmail, approverPassword);
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
}

async function api<T>(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'shr_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, {
    method,
    ...(data === undefined ? {} : { data }),
    headers: { 'x-csrf-token': csrf, origin: 'http://localhost:3000' },
  });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as T };
}

async function approve(page: Page, title: RegExp) {
  await page.goto('/approvals');
  await page.getByRole('link', { name: title }).click();
  await page.getByRole('region', { name: 'Your decision' }).getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('You approved this request.')).toBeVisible();
}

test('an owner drafts an opening and a checklist', async ({ page, browser }) => {
  await signInAsOwner(page);
  const company = await api<{ id: string }>(page, 'POST', '/v1/org/companies', {
    code: `RC-${run}`,
    name: `Hiring Co ${run}`,
    country: 'IN',
    baseCurrency: 'INR',
    timezone: 'Asia/Kolkata',
  });
  expect(company.status).toBe(201);
  const approver = await api<{ id: string }>(page, 'POST', '/v1/employees', {
    firstName: 'Kiran',
    lastName: `Approver ${run}`,
    workEmail: approverEmail,
    companyId: company.body.id,
    dateOfJoining: '2026-01-01',
  });
  const invite = await api<{ membershipId: string }>(
    page,
    'POST',
    `/v1/employees/${approver.body.id}/sign-in`,
    {},
  );
  expect(invite.status).toBe(201);
  for (const subjectType of ['job_requisition', 'job_offer']) {
    const policy = await api(page, 'POST', '/v1/approvals/policies', {
      subjectType,
      name: `${subjectType} ${run}`,
      definition: {
        distinctApprovers: true,
        stages: [
          {
            name: 'Hiring head',
            mode: 'ANY',
            approvers: [{ type: 'MEMBER', membershipId: invite.body.membershipId }],
          },
        ],
      },
    });
    expect(policy.status).toBe(201);
  }

  // The approver sets a password from the invitation.
  const email = await waitForEmail(approverEmail, '/reset-password?token=');
  const url = new URL(/https?:\/\/\S+reset-password\?\S+/.exec(email)![0]);
  const approverPage = await browser.newPage();
  await approverPage.goto(`${url.pathname}${url.search}`);
  await approverPage.getByLabel('New password', { exact: true }).fill(approverPassword);
  await approverPage.getByLabel('Confirm new password').fill(approverPassword);
  await approverPage.getByRole('button', { name: 'Set new password' }).click();
  await expect(approverPage).toHaveURL(/reason=account-ready/);
  await approverPage.close();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Onboarding' }).click();
  await page
    .getByRole('navigation', { name: 'Onboarding' })
    .getByRole('link', { name: 'Checklists' })
    .click();
  await page.getByRole('button', { name: 'Add checklist' }).click();
  const cl = page.getByRole('dialog');
  await cl.getByLabel('Name').fill(checklist);
  await cl.getByLabel('Task 1', { exact: true }).fill('Issue badge and uniform');
  await cl.getByRole('button', { name: 'Add task' }).click();
  await cl.getByLabel('Task 2', { exact: true }).fill('Ward orientation');
  await cl.getByLabel('For', { exact: true }).nth(1).selectOption('MANAGER');
  await cl.getByLabel('Day', { exact: true }).nth(1).fill('1');
  await cl.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(`“${checklist}” saved.`)).toBeVisible();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Recruitment' }).click();
  await page.getByRole('button', { name: 'New opening' }).click();
  const op = page.getByRole('dialog');
  await op.getByLabel('Job title').fill(jobTitle);
  await op.getByLabel('Company').selectOption({ label: `Hiring Co ${run}` });
  await op.getByLabel('Description').fill('Day shifts on the cardiac ward.');
  await op.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/recruitment\/openings\//);
  openingUrl = page.url();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByText('Sent for approval.')).toBeVisible();
});

test('the approver approves the opening', async ({ page }) => {
  await signInAsApprover(page);
  await approve(page, new RegExp(`New position: ${jobTitle}`));
});

test('the owner adds a candidate, schedules an interview and makes an offer', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto(openingUrl);
  await expect(page.getByText('Open', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add candidate' }).click();
  const c = page.getByRole('dialog');
  await c.getByLabel('First name').fill('Divya');
  await c.getByLabel('Last name').fill(`Nair${run}`);
  await c.getByLabel('Email').fill(`divya-${run.toLowerCase()}@example.test`);
  await c.getByLabel('Source (optional)').selectOption('Referral');
  await c
    .getByLabel('Résumé (optional)')
    .setInputFiles({ name: 'divya-cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 CV') });
  await c.getByRole('button', { name: 'Add candidate' }).click();
  await expect(page).toHaveURL(/\/recruitment\/applications\//);
  applicationUrl = page.url();
  await expect(page.getByRole('heading', { level: 1, name: candidate })).toBeVisible();
  await expect(page.getByRole('link', { name: /Download résumé/ })).toBeVisible();

  await page.getByRole('button', { name: 'Schedule interview' }).click();
  const iv = page.getByRole('dialog');
  await iv.getByLabel('Date and time').fill('2026-11-20T11:00');
  await iv.getByLabel('Interviewers').fill(`Approver ${run}`);
  await iv.getByRole('button', { name: 'Add' }).click();
  await iv.getByRole('button', { name: 'Schedule' }).click();
  await expect(page.getByText('Interview scheduled. The interviewers have been told.')).toBeVisible();
  await expect(page.getByText('Interviewing', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Make an offer' }).click();
  const of = page.getByRole('dialog');
  await of.getByLabel('Joining date').fill('2026-12-07');
  await of.getByLabel('Annual CTC (optional)').fill('650000');
  await of.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByText('Offer sent for approval.')).toBeVisible();
});

test('the approver gives interview feedback and approves the offer', async ({ page }) => {
  await signInAsApprover(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Recruitment' }).click();
  await page
    .getByRole('navigation', { name: 'Recruitment' })
    .getByRole('link', { name: 'My interviews' })
    .click();
  await expect(page.getByText('Feedback due')).toBeVisible();
  await page.getByRole('link', { name: candidate }).click();
  await page.getByRole('button', { name: 'Give feedback' }).click();
  const fb = page.getByRole('dialog');
  await fb.getByLabel('Rating').selectOption('5');
  await fb.getByLabel('Recommendation').selectOption('STRONG_YES');
  await fb.getByLabel('What you saw').fill('Excellent patient communication and triage.');
  await fb.getByRole('button', { name: 'Give feedback' }).click();
  await expect(page.getByText('Thank you — your feedback is saved.')).toBeVisible();
  await approve(page, new RegExp(`Offer: ${candidate}`));
});

test('the owner records the acceptance and hires; onboarding starts', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto(applicationUrl);
  await expect(page.getByText('Strong yes, 5/5')).toBeVisible();
  await page.getByRole('button', { name: 'Candidate accepted' }).click();
  await expect(page.getByText('Offer accepted.')).toBeVisible();
  await page.getByRole('button', { name: 'Hire' }).click();
  const hire = page.getByRole('dialog');
  await hire.getByLabel('Onboarding checklist (optional)').selectOption({ label: checklist });
  await hire.getByRole('button', { name: 'Hire' }).click();
  await expect(page.getByText('Hired. Their employee record is ready.')).toBeVisible();
  await page.getByRole('link', { name: 'Open their employee record' }).click();
  await expect(page.getByRole('heading', { level: 1, name: candidate })).toBeVisible();
  await page.getByRole('tab', { name: 'Onboarding' }).click();
  await expect(page.getByText('Issue badge and uniform')).toBeVisible();
  await expect(page.getByText('0 of 2 done')).toBeVisible();
  await page.getByRole('button', { name: 'Mark “Issue badge and uniform” done' }).click();
  await expect(page.getByText('1 of 2 done')).toBeVisible();
});
