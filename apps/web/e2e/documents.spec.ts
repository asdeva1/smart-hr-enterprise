/**
 * Documents end to end: an owner adds a letter template, makes a letter for an employee from their record,
 * uploads a document and sends the letter for signature; the employee signs it from Documents and the signed
 * copy, with its certificate, lands on their record.
 */
import { expect, test, type Page } from '@playwright/test';
import { account, signIn, waitForEmail } from './support';

test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).toUpperCase();
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const staffEmail = `docs-${run.toLowerCase()}@e2e.smarthr.test`;
const staffPassword = `Harbour lantern quill ${run}`;
const templateName = `Appointment letter ${run}`;
let employeeId = '';

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

test('an employee is set up and can sign in', async ({ page, browser }) => {
  await signInAsOwner(page);
  const company = await api<{ id: string }>(page, 'POST', '/v1/org/companies', {
    code: `DC-${run}`,
    name: `Docs Co ${run}`,
    country: 'IN',
    baseCurrency: 'INR',
    timezone: 'Asia/Kolkata',
  });
  expect(company.status).toBe(201);
  const staff = await api<{ id: string }>(page, 'POST', '/v1/employees', {
    firstName: 'Meera',
    lastName: `Iyer ${run}`,
    workEmail: staffEmail,
    companyId: company.body.id,
    dateOfJoining: '2026-02-02',
  });
  expect(staff.status).toBe(201);
  employeeId = staff.body.id;
  expect((await api(page, 'POST', `/v1/employees/${employeeId}/sign-in`, {})).status).toBe(201);

  const email = await waitForEmail(staffEmail, '/reset-password?token=');
  const link = /https?:\/\/\S+reset-password\?\S+/.exec(email)?.[0];
  const url = new URL(link!);
  const staffPage = await browser.newPage();
  await staffPage.goto(`${url.pathname}${url.search}`);
  await staffPage.getByLabel('New password', { exact: true }).fill(staffPassword);
  await staffPage.getByLabel('Confirm new password').fill(staffPassword);
  await staffPage.getByRole('button', { name: 'Set new password' }).click();
  await expect(staffPage).toHaveURL(/reason=account-ready/);
  await staffPage.close();
});

test('an owner makes a letter, adds a document and sends the letter for signature', async ({ page }) => {
  await signInAsOwner(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Documents' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Documents' })
    .getByRole('link', { name: 'Letter templates' })
    .click();
  await page.getByRole('button', { name: 'Add template' }).click();
  const tpl = page.getByRole('dialog');
  await tpl.getByLabel('Name').fill(templateName);
  await tpl.getByLabel('Letter text').fill('Dear {{employee.salary}},');
  await tpl.getByRole('button', { name: 'Save' }).click();
  await expect(tpl.getByText('Unknown placeholder: {{employee.salary}}')).toBeVisible();
  await tpl
    .getByLabel('Letter text')
    .fill(
      'Dear {{employee.firstName}},\n\nWelcome to {{organisation.name}}. You join us on {{employee.joinDate}}.',
    );
  await tpl.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(`“${templateName}” saved.`)).toBeVisible();

  await page.goto(`/employees/${employeeId}?tab=documents`);
  await page.getByRole('button', { name: 'Make a letter' }).click();
  const letter = page.getByRole('dialog');
  await letter.getByLabel('Template').selectOption({ label: templateName });
  await expect(letter.getByRole('region', { name: 'Letter preview' })).toContainText('Dear Meera,');
  await expect(letter.getByRole('region', { name: 'Letter preview' })).toContainText('2 February 2026');
  await letter.getByRole('button', { name: 'Make letter' }).click();
  await expect(page.getByText(/made and added/)).toBeVisible();

  await page.getByRole('button', { name: 'Add a document' }).click();
  const up = page.getByRole('dialog');
  await up.getByLabel('File').setInputFiles({
    name: 'passport.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Passport copy'),
  });
  await up.getByLabel('Title').fill('Passport');
  await up.getByLabel('Category').selectOption({ label: 'Identity' });
  await up.getByLabel('Expires on (optional)').fill('2030-05-01');
  await up.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText('“Passport” added.')).toBeVisible();
  const passportRow = page.getByRole('row').filter({ hasText: 'Passport' });
  await expect(passportRow).toContainText('Identity');

  const letterRow = page.getByRole('row').filter({ hasText: templateName });
  await letterRow.getByRole('button', { name: 'Send for signature' }).click();
  const send = page.getByRole('dialog');
  await expect(send.getByRole('region', { name: 'Signers' })).toContainText(`Meera Iyer ${run}`);
  await send.getByRole('button', { name: 'Send for signature' }).click();
  await expect(page).toHaveURL(/\/documents\/signatures\//);
  await expect(page.getByText('Out for signature')).toBeVisible();
  await expect(page.getByText('To sign', { exact: true })).toBeVisible();
});

test('the employee signs, and the signed copy is on their record', async ({ page }) => {
  await signIn(page, staffEmail, staffPassword);
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Documents' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Passport' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Documents' }).getByRole('link', { name: 'Signatures' }).click();
  await page.getByRole('link', { name: new RegExp(templateName) }).click();

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download document' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);

  const box = page.getByRole('region', { name: 'Your signature' });
  await expect(box.getByRole('button', { name: 'Sign' })).toBeDisabled();
  await box.getByLabel('Type your full name').fill(`Meera Iyer`);
  await box.getByLabel(/I have read this document/).check();
  await box.getByRole('button', { name: 'Sign' }).click();
  await expect(page.getByText('Signed. Everyone has now signed.')).toBeVisible();
  await expect(page.getByText('Signed as “Meera Iyer”')).toBeVisible();
  const signed = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download signed copy' }).click();
  expect((await signed).suggestedFilename()).toMatch(/\(signed\)\.pdf$/);

  await page.getByRole('link', { name: 'Signatures', exact: true }).first().click();
  await page.goto('/documents');
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: `${templateName}` })
      .filter({ hasText: '(signed)' }),
  ).toBeVisible();
});
