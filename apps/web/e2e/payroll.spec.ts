/**
 * Payroll end to end: an owner sets an employee's salary and professional-tax state on their record,
 * starts April's payroll for the company and sends it for approval; a named approver (who is also paid in
 * it) approves; the payslip then appears under My payslips as a PDF, and the owner marks the run paid.
 */
import { expect, test, type Page } from '@playwright/test';
import { account, signIn, waitForEmail } from './support';

test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).toUpperCase();
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const staffEmail = `payroll-${run.toLowerCase()}@e2e.smarthr.test`;
const staffPassword = `Saffron ledger window ${run}`;
const companyName = `Payroll Co ${run}`;
let employeeId = '';
let runUrl = '';

async function signInAsOwner(page: Page) {
  const admin = account('ADMIN');
  await signIn(page, admin.email, admin.password);
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

test('an owner sets a salary and starts April’s payroll', async ({ page, browser }) => {
  await signInAsOwner(page);
  const company = await api<{ id: string }>(page, 'POST', '/v1/org/companies', {
    code: `PY-${run}`,
    name: companyName,
    country: 'IN',
    baseCurrency: 'INR',
    timezone: 'Asia/Kolkata',
  });
  expect(company.status).toBe(201);
  const staff = await api<{ id: string }>(page, 'POST', '/v1/employees', {
    firstName: 'Lakshmi',
    lastName: `Rao ${run}`,
    workEmail: staffEmail,
    companyId: company.body.id,
    dateOfJoining: '2025-06-01',
  });
  employeeId = staff.body.id;
  const invite = await api<{ membershipId: string }>(page, 'POST', `/v1/employees/${employeeId}/sign-in`, {});
  expect(invite.status).toBe(201);
  const policy = await api(page, 'POST', '/v1/approvals/policies', {
    subjectType: 'payroll_run',
    name: `Payroll ${run}`,
    definition: {
      distinctApprovers: true,
      stages: [
        {
          name: 'Finance head',
          mode: 'ANY',
          approvers: [{ type: 'MEMBER', membershipId: invite.body.membershipId }],
        },
      ],
    },
  });
  expect(policy.status).toBe(201);
  const email = await waitForEmail(staffEmail, '/reset-password?token=');
  const url = new URL(/https?:\/\/\S+reset-password\?\S+/.exec(email)![0]);
  const staffPage = await browser.newPage();
  await staffPage.goto(`${url.pathname}${url.search}`);
  await staffPage.getByLabel('New password', { exact: true }).fill(staffPassword);
  await staffPage.getByLabel('Confirm new password').fill(staffPassword);
  await staffPage.getByRole('button', { name: 'Set new password' }).click();
  await expect(staffPage).toHaveURL(/reason=account-ready/);
  await staffPage.close();

  await page.goto(`/employees/${employeeId}?tab=pay`);
  await expect(page.getByText('No salary yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Add salary' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Effective from').fill('2025-06-01');
  await dialog.getByLabel('Annual CTC').fill('792000');
  await dialog.getByLabel('Basic').fill('30000');
  await dialog.getByLabel('House rent allowance').fill('15000');
  await dialog.getByLabel('Special allowance').fill('15000');
  await expect(dialog.getByText('₹60,000')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save salary' }).click();
  await expect(page.getByText('Salary saved.')).toBeVisible();
  await page.getByLabel('Professional tax state').selectOption('KA');
  await page.getByRole('button', { name: 'Save payroll details' }).click();
  await expect(page.getByText('Payroll details saved.')).toBeVisible();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Payroll' }).click();
  await page.getByRole('button', { name: 'Start payroll' }).click();
  const start = page.getByRole('dialog');
  await start.getByLabel('Company').selectOption({ label: companyName });
  await start.getByLabel('Month').fill('2026-04');
  await start.getByRole('button', { name: 'Start and calculate' }).click();
  await expect(page).toHaveURL(/\/payroll\/runs\//);
  runUrl = page.url();
  await expect(page.getByRole('heading', { level: 1, name: 'Payroll for April 2026' })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: `Lakshmi Rao ${run}` });
  // ₹60,000 less PF (12% of ₹15,000) and Karnataka professional tax; no income tax under the rebate.
  await expect(row).toContainText('₹58,000');
  await row.getByRole('button', { name: /Details for/ }).click();
  await expect(page.getByRole('dialog').getByText('Provident fund', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByText('Sent for approval.')).toBeVisible();
});

test('the approver approves, and their payslip is ready', async ({ page }) => {
  await signIn(page, staffEmail, staffPassword);
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
  await page.goto('/approvals');
  await page.getByRole('link', { name: new RegExp(`Payroll April 2026: ${companyName}`) }).click();
  await page.getByRole('region', { name: 'Your decision' }).getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('You approved this request.')).toBeVisible();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Payroll' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'April 2026' })).toContainText('₹58,000');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download payslip for April 2026' }).click();
  expect((await download).suggestedFilename()).toMatch(/^payslip-.*-2026-04\.pdf$/);
});

test('the owner downloads the register and marks the run paid', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto(runUrl);
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  const register = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Payroll register' }).click();
  expect((await register).suggestedFilename()).toBe('payroll-register-2026-04.csv');
  await page.getByRole('button', { name: 'Mark as paid' }).click();
  await expect(page.getByText('Marked as paid.')).toBeVisible();
});
