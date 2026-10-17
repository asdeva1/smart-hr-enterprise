/**
 * Leave end to end: an owner sets up a leave type and a company holiday through the screens; an employee
 * applies (the holiday isn't counted), their manager approves from Approvals, the balance goes down, and the
 * employee cancels it again. The employee is invited from their record and signs in from the emailed link.
 */
import { expect, test, type Page } from '@playwright/test';
import { account, signIn, waitForEmail } from './support';

test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).toUpperCase();
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const companyName = `Leave Co ${run}`;
const typeName = `Earned leave ${run}`;
const staffEmail = `leave-${run.toLowerCase()}@e2e.smarthr.test`;
const staffPassword = `Monsoon ward lantern ${run}`;

/** The Monday at least two weeks ahead, as yyyy-mm-dd, and the day after it. */
const monday = (() => {
  const d = new Date(Date.now() + 14 * 86_400_000);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();
const tuesday = new Date(Date.parse(`${monday}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const wednesday = new Date(Date.parse(`${monday}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);

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

test('an owner sets up a leave type and a company holiday', async ({ page }) => {
  await signInAsOwner(page);
  const company = await api<{ id: string }>(page, 'POST', '/v1/org/companies', {
    code: `LV-${run}`,
    name: companyName,
    country: 'IN',
    baseCurrency: 'INR',
    timezone: 'Asia/Kolkata',
  });
  expect(company.status).toBe(201);

  // The owner manages the nurse, so they need their own employee record (earlier files may have made it).
  const me = await api<{ employee: { id: string } | null }>(page, 'GET', '/v1/attendance/me/today');
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
  const nurse = await api<{ id: string }>(page, 'POST', '/v1/employees', {
    firstName: 'Lata',
    lastName: `Menon ${run}`,
    workEmail: staffEmail,
    companyId: company.body.id,
    managerId: ownerEmployeeId,
    dateOfJoining: '2026-01-01',
  });
  expect(nurse.status).toBe(201);
  expect((await api(page, 'POST', `/v1/employees/${nurse.body.id}/sign-in`, {})).status).toBe(201);

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Leave' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Leave' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Leave' }).getByRole('link', { name: 'Leave types' }).click();
  await page.getByRole('button', { name: 'New leave type' }).click();
  const typeDialog = page.getByRole('dialog');
  await typeDialog.getByLabel('Code').fill(`EL${run}`.slice(0, 20));
  await typeDialog.getByLabel('Name').fill(typeName);
  await typeDialog.getByLabel('Days per year').fill('12');
  await typeDialog.getByRole('button', { name: 'Create leave type' }).click();
  await expect(page.getByText(`${typeName} added.`)).toBeVisible();

  await page.getByRole('navigation', { name: 'Leave' }).getByRole('link', { name: 'Holidays' }).click();
  await page.getByRole('button', { name: 'New calendar' }).click();
  const calDialog = page.getByRole('dialog');
  await calDialog.getByLabel('Name').fill(`${companyName} holidays`);
  await calDialog.getByLabel('For').selectOption('COMPANY');
  await calDialog.getByLabel('Company').selectOption({ label: companyName });
  await calDialog.getByRole('button', { name: 'Create calendar' }).click();
  await expect(page.getByRole('heading', { level: 2, name: `${companyName} holidays` })).toBeVisible();
  const add = page.getByRole('form', { name: 'Add a holiday' });
  await add.getByLabel('Date').fill(tuesday);
  await add.getByLabel('Holiday').fill(`Founders day ${run}`);
  await add.getByRole('button', { name: 'Add holiday' }).click();
  await expect(page.getByText(`Founders day ${run} added`)).toBeVisible();
});

test('an employee applies, their manager approves, and the balance goes down', async ({ page, browser }) => {
  const email = await waitForEmail(staffEmail, '/reset-password?token=');
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

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Leave' }).click();
  const card = page.getByRole('listitem').filter({ hasText: typeName });
  await expect(card).toContainText('12 days balance');
  await expect(page.getByText(`Founders day ${run}`)).toBeVisible();

  await page.getByRole('button', { name: 'Apply for leave' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Leave type').selectOption({ label: typeName });
  await dialog.getByLabel('From').fill(monday);
  await dialog.getByLabel('To').fill(wednesday);
  // Tuesday is the company holiday, so Monday to Wednesday uses two days.
  await expect(dialog.getByRole('status')).toContainText(
    'Uses 2 days of 12 days available, leaving 10 days.',
  );
  await dialog.getByLabel('Reason').fill('Visiting family');
  await dialog.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page).toHaveURL(/\/leave\/requests\//);
  await expect(page.getByText('Waiting for approval')).toBeVisible();
  const requestUrl = page.url();

  const ownerPage = await browser.newPage();
  await signInAsOwner(ownerPage);
  await ownerPage.goto('/approvals');
  await ownerPage.getByRole('link', { name: new RegExp(`${typeName}: Lata Menon ${run}`) }).click();
  await ownerPage
    .getByRole('region', { name: 'Your decision' })
    .getByRole('button', { name: 'Approve' })
    .click();
  await expect(ownerPage.getByText('You approved this request.')).toBeVisible();
  await ownerPage.close();

  await page.goto(requestUrl);
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await page.goto('/leave');
  await expect(card).toContainText('10 days balance');

  // Cancelling before it starts puts the days back.
  await page.goto(requestUrl);
  await page.getByRole('button', { name: 'Cancel leave' }).click();
  await page
    .getByRole('region', { name: 'Confirm cancellation' })
    .getByRole('button', { name: 'Cancel leave' })
    .click();
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
  await page.goto('/leave');
  await expect(card).toContainText('12 days balance');
});
