/**
 * Employment changes through approval, end to end: the owner turns on "go for approval first", records a
 * promotion (nothing changes yet, the profile says it's waiting), a named approver approves it from Approvals,
 * and the promotion then appears in the history. The setting is turned back off at the end.
 */
import { expect, test, type Page } from '@playwright/test';
import { account, latestEmailTo, signIn } from './support';

test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).toUpperCase();
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const approverEmail = `approver-${run.toLowerCase()}@e2e.smarthr.test`;
const approverPassword = `Quiet harbour ledger ${run}`;
const staffName = `Ravi Kumar ${run}`;

async function signInAsOwner(page: Page) {
  const admin = account('ADMIN');
  await signIn(page, admin.email, admin.password);
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
}

async function api<T>(page: Page, method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'shr_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, {
    method,
    ...(data === undefined ? {} : { data }),
    headers: { 'x-csrf-token': csrf, origin: 'http://localhost:3000' },
  });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as T };
}

let employeeId = '';

test('a promotion waits for approval when the organisation asks for it', async ({ page }) => {
  await signInAsOwner(page);
  const company = await api<{ id: string }>(page, 'POST', '/v1/org/companies', {
    code: `EC-${run}`,
    name: `Changes Co ${run}`,
    country: 'IN',
    baseCurrency: 'INR',
    timezone: 'Asia/Kolkata',
  });
  expect(company.status).toBe(201);
  const designations: string[] = [];
  for (const [code, name] of [
    [`TECH-${run}`, `Technician ${run}`],
    [`STECH-${run}`, `Senior technician ${run}`],
  ]) {
    designations.push(
      (await api<{ id: string }>(page, 'POST', '/v1/master-data/designation', { code, name })).body.id,
    );
  }

  // A named approver for employment changes: someone invited from their employee record.
  const approver = await api<{ id: string }>(page, 'POST', '/v1/employees', {
    firstName: 'Anita',
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
  const policy = await api(page, 'POST', '/v1/approvals/policies', {
    subjectType: 'employee_change',
    name: `Employment changes ${run}`,
    definition: {
      distinctApprovers: true,
      stages: [
        {
          name: 'HR head',
          mode: 'ANY',
          approvers: [{ type: 'MEMBER', membershipId: invite.body.membershipId }],
        },
      ],
    },
  });
  expect(policy.status).toBe(201);
  const staff = await api<{ id: string }>(page, 'POST', '/v1/employees', {
    firstName: 'Ravi',
    lastName: `Kumar ${run}`,
    companyId: company.body.id,
    designationId: designations[0],
    dateOfJoining: '2026-01-01',
  });
  employeeId = staff.body.id;

  // The setting, through the settings page.
  await page.goto('/admin/settings');
  await page.getByLabel('Employment changes').selectOption('APPROVAL');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText(/Saved 1 setting/)).toBeVisible();

  await page.goto(`/employees/${employeeId}`);
  await page.getByLabel('Change employment').selectOption('promotion');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Designation').selectOption({ label: `Senior technician ${run}` });
  await dialog.getByLabel('Note (optional, kept in the history)').fill('Certification passed');
  await dialog.getByRole('button', { name: 'Record promotion' }).click();
  await expect(page.getByText('Sent for approval. It takes effect once approved.')).toBeVisible();
  await expect(page.getByText(/Promotion from .* is waiting for approval/)).toBeVisible();
  await expect(page.getByText(`Technician ${run}`, { exact: false }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByRole('list', { name: 'Employment history' }).getByText('Promoted')).toHaveCount(0);
});

test('the approver approves it, and only then it is applied', async ({ page, browser }) => {
  const email = await latestEmailTo(approverEmail);
  const link = /https?:\/\/\S+reset-password\?\S+/.exec(email)?.[0];
  expect(link).toBeTruthy();
  const url = new URL(link!);
  await page.goto(`${url.pathname}${url.search}`);
  await page.getByLabel('New password', { exact: true }).fill(approverPassword);
  await page.getByLabel('Confirm new password').fill(approverPassword);
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page).toHaveURL(/reason=account-ready/);
  await signIn(page, approverEmail, approverPassword);
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();

  await page.goto('/approvals');
  await page.getByRole('link', { name: new RegExp(`Promotion: ${staffName}`) }).click();
  await page.getByRole('region', { name: 'Your decision' }).getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('You approved this request.')).toBeVisible();

  const owner = await browser.newPage();
  await signInAsOwner(owner);
  await owner.goto(`/employees/${employeeId}`);
  await expect(owner.getByText(/is waiting for approval/)).toHaveCount(0);
  await owner.getByRole('tab', { name: 'History' }).click();
  const history = owner.getByRole('list', { name: 'Employment history' });
  await expect(history.getByText('Promoted')).toBeVisible();
  await expect(history.getByText(`Designation: Technician ${run} → Senior technician ${run}`)).toBeVisible();

  // Back to the default, so other tests (and re-runs) apply changes straight away.
  const reset = await api(owner, 'PUT', '/v1/tenant/configuration', {
    values: { employment_changes: 'DIRECT' },
  });
  expect(reset.status).toBe(200);
  await owner.close();
});
