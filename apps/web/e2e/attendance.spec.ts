/**
 * Attendance end to end: an owner sets up a shift, clocks in and out, and approves an employee's correction.
 * The employee is invited through their employee record and signs in from the emailed link, so the test
 * doesn't depend on other files' accounts. Each run uses its own company, shift and people.
 */
import { expect, test, type Page } from '@playwright/test';
import { account, latestEmailTo, signIn } from './support';

test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).toUpperCase();
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const companyName = `Attendance Co ${run}`;
const shiftName = `General ${run}`;
const staffEmail = `nurse-${run.toLowerCase()}@e2e.smarthr.test`;
const staffPassword = `Ward round lantern ${run}`;
const staffName = `Kavya Rao ${run}`;

async function signInAsOwner(page: Page) {
  const admin = account('ADMIN');
  await signIn(page, admin.email, admin.password);
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
}

/** Calls the API as the signed-in browser (same cookies, CSRF header), to set up records quickly. */
async function api<T>(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'shr_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, {
    method,
    ...(data === undefined ? {} : { data }),
    headers: { 'x-csrf-token': csrf, origin: 'http://localhost:3000' },
  });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as T };
}

/** Yesterday in India, as yyyy-mm-dd. */
function yesterdayInIndia(): string {
  const now = new Date(Date.now() - 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}

test('an owner sets up a shift and clocks in and out', async ({ page }) => {
  await signInAsOwner(page);
  const company = await api<{ id: string }>(page, 'POST', '/v1/org/companies', {
    code: `ATT-${run}`,
    name: companyName,
    country: 'IN',
    baseCurrency: 'INR',
    timezone: 'Asia/Kolkata',
  });
  expect(company.status).toBe(201);

  // The owner needs an employee record linked to their own sign-in to clock in. Earlier runs may have made it.
  const me = await api<{ employee: { id: string } | null }>(page, 'GET', '/v1/attendance/me/today');
  expect(me.status).toBe(200);
  let ownerEmployeeId = me.body.employee?.id;
  if (!ownerEmployeeId) {
    const owner = await api<{ id: string }>(page, 'POST', '/v1/employees', {
      firstName: 'E2E',
      lastName: 'Owner',
      workEmail: account('ADMIN').email,
      companyId: company.body.id,
      dateOfJoining: '2026-01-01',
    });
    expect(owner.status).toBe(201);
    ownerEmployeeId = owner.body.id;
    expect((await api(page, 'POST', `/v1/employees/${owner.body.id}/sign-in`, {})).status).toBe(201);
  }

  // A nurse in the new company who reports to the owner, invited to sign in.
  const nurse = await api<{ id: string }>(page, 'POST', '/v1/employees', {
    firstName: 'Kavya',
    lastName: `Rao ${run}`,
    workEmail: staffEmail,
    companyId: company.body.id,
    managerId: ownerEmployeeId,
    dateOfJoining: '2026-01-01',
  });
  expect(nurse.status).toBe(201);
  expect((await api(page, 'POST', `/v1/employees/${nurse.body.id}/sign-in`, {})).status).toBe(201);

  // Shift set-up through the screens.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Attendance' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Attendance' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Attendance' }).getByRole('link', { name: 'Shifts' }).click();
  await page.getByRole('button', { name: 'New shift' }).click();
  const shiftDialog = page.getByRole('dialog');
  await shiftDialog.getByLabel('Code').fill(`G${run}`.slice(0, 20));
  await shiftDialog.getByLabel('Name').fill(shiftName);
  await shiftDialog.getByLabel('Starts').fill('09:00');
  await shiftDialog.getByLabel('Ends').fill('18:00');
  await shiftDialog.getByRole('button', { name: 'Create shift' }).click();
  await expect(
    page.getByRole('table', { name: 'Shifts' }).getByRole('row').filter({ hasText: shiftName }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Assign shift' }).click();
  const assign = page.getByRole('dialog');
  await assign.getByLabel('Shift').selectOption({ label: `${shiftName} (09:00–18:00)` });
  await assign.getByLabel('Who').selectOption('COMPANY');
  await assign.getByLabel('Company').selectOption({ label: companyName });
  await assign.getByRole('button', { name: 'Assign' }).click();
  await expect(page.getByText(/\d+ (person is|people are) on the new shift/)).toBeVisible();

  // Clock in and out on My attendance.
  await page
    .getByRole('navigation', { name: 'Attendance' })
    .getByRole('link', { name: 'My attendance' })
    .click();
  const today = page.getByRole('region', { name: /Today/ });
  await today.getByRole('button', { name: 'Clock in' }).click();
  await expect(today.getByText(/In since/)).toBeVisible();
  await today.getByRole('button', { name: 'Clock out' }).click();
  await expect(today.getByText('Clocked out')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Today’s clock-ins' }).getByRole('listitem')).toHaveCount(2);
});

test('an employee asks for a correction and their manager approves it', async ({ page, browser }) => {
  // The nurse accepts the invitation from the email and signs in.
  const email = await latestEmailTo(staffEmail);
  const link = /https?:\/\/\S+reset-password\?\S+/.exec(email)?.[0];
  expect(link).toBeTruthy();
  const url = new URL(link!);
  await page.goto(`${url.pathname}${url.search}`);
  await page.getByLabel('New password', { exact: true }).fill(staffPassword);
  await page.getByLabel('Confirm new password').fill(staffPassword);
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page).toHaveURL(/reason=account-ready/);
  await signIn(page, staffEmail, staffPassword);
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Attendance' }).click();
  await expect(page.getByText(shiftName)).toBeVisible();
  await page.getByRole('button', { name: 'Ask for a correction' }).click();
  const dialog = page.getByRole('dialog');
  const day = yesterdayInIndia();
  await dialog.getByLabel('Day').fill(day);
  await dialog.getByLabel('Clock-in time').fill('09:05');
  await dialog.getByLabel('Clock-out time').fill('18:10');
  await dialog.getByRole('button', { name: 'Send for approval' }).click();
  // A reason is required.
  await expect(dialog.getByLabel('What happened')).toHaveAttribute('aria-invalid', 'true');
  await dialog.getByLabel('What happened').fill('Badge reader at the ward entrance was down');
  await dialog.getByRole('button', { name: 'Send for approval' }).click();
  await expect(dialog).toBeHidden();
  const corrections = page.getByRole('table', { name: 'My corrections' });
  await expect(corrections.getByText('Waiting for approval')).toBeVisible();

  // The owner, as the nurse's manager, approves it.
  const ownerPage = await browser.newPage();
  await signInAsOwner(ownerPage);
  await ownerPage.goto('/approvals');
  await ownerPage.getByRole('link', { name: `Attendance correction: ${staffName}, ${day}` }).click();
  const decision = ownerPage.getByRole('region', { name: 'Your decision' });
  await decision.getByRole('button', { name: 'Approve' }).click();
  await expect(ownerPage.getByText('You approved this request.')).toBeVisible();
  await ownerPage.close();

  // The nurse's correction is approved and the day now has both times.
  await page.reload();
  await expect(corrections.getByText('Approved')).toBeVisible();
  await expect(corrections.getByRole('row').filter({ hasText: 'Badge reader' })).toContainText('09:05');
});
