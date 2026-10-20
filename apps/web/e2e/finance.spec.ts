/**
 * Finance end to end: an owner drafts a balanced journal in a new company's books and sends it for
 * approval; a named approver (with no finance access of their own) approves it from their inbox; the owner
 * then sees it posted, in the bank ledger, and in the trial balance and profit and loss.
 */
import { expect, test, type Page } from '@playwright/test';
import { account, signIn, waitForEmail } from './support';

test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).toUpperCase();
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const approverEmail = `books-${run.toLowerCase()}@e2e.smarthr.test`;
const approverPassword = `Copper abacus meadow ${run}`;
const companyName = `Books Co ${run}`;
const narration = `Consulting income ${run}`;
let journalUrl = '';

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

test('an owner drafts a journal and sends it for approval', async ({ page, browser }) => {
  await signInAsOwner(page);
  const company = await api<{ id: string }>(page, 'POST', '/v1/org/companies', {
    code: `BK-${run}`,
    name: companyName,
    country: 'IN',
    baseCurrency: 'INR',
    timezone: 'Asia/Kolkata',
  });
  expect(company.status).toBe(201);
  const staff = await api<{ id: string }>(page, 'POST', '/v1/employees', {
    firstName: 'Meera',
    lastName: `Iyer ${run}`,
    workEmail: approverEmail,
    companyId: company.body.id,
    dateOfJoining: '2025-06-01',
  });
  const invite = await api<{ membershipId: string }>(
    page,
    'POST',
    `/v1/employees/${staff.body.id}/sign-in`,
    {},
  );
  expect(invite.status).toBe(201);
  const policy = await api(page, 'POST', '/v1/approvals/policies', {
    subjectType: 'journal_entry',
    name: `Journals ${run}`,
    definition: {
      distinctApprovers: true,
      stages: [
        {
          name: 'Controller',
          mode: 'ANY',
          approvers: [{ type: 'MEMBER', membershipId: invite.body.membershipId }],
        },
      ],
    },
  });
  expect(policy.status).toBe(201);
  const email = await waitForEmail(approverEmail, '/reset-password?token=');
  const url = new URL(/https?:\/\/\S+reset-password\?\S+/.exec(email)![0]);
  const staffPage = await browser.newPage();
  await staffPage.goto(`${url.pathname}${url.search}`);
  await staffPage.getByLabel('New password', { exact: true }).fill(approverPassword);
  await staffPage.getByLabel('Confirm new password').fill(approverPassword);
  await staffPage.getByRole('button', { name: 'Set new password' }).click();
  await expect(staffPage).toHaveURL(/reason=account-ready/);
  await staffPage.close();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Finance' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Finance' })).toBeVisible();
  await page.getByLabel('Company').selectOption({ label: companyName });
  await expect(page.getByText('No journals yet')).toBeVisible();
  await page.getByRole('button', { name: 'New journal' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Date').fill('2026-04-10');
  await dialog.getByLabel('What it’s for').fill(narration);
  await dialog.getByLabel('Line 1 account').selectOption({ label: '1100 · Bank' });
  await dialog.getByLabel('Line 1 debit').fill('25000');
  await dialog.getByLabel('Line 2 account').selectOption({ label: '4000 · Revenue from operations' });
  await dialog.getByLabel('Line 2 credit').fill('24000');
  await expect(dialog.getByText('Off by 1,000.00')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  await dialog.getByLabel('Line 2 credit').fill('25000');
  await dialog.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/\/finance\/journals\//);
  journalUrl = page.url();
  await expect(page.getByRole('heading', { level: 1, name: 'Draft journal' })).toBeVisible();
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByText('Waiting for approval.')).toBeVisible();
});

test('the approver approves it from their inbox', async ({ page }) => {
  await signIn(page, approverEmail, approverPassword);
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
  // No finance access of their own.
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Finance' }),
  ).toHaveCount(0);
  await page.goto('/approvals');
  await page.getByRole('link', { name: new RegExp(narration) }).click();
  await page.getByRole('region', { name: 'Your decision' }).getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('You approved this request.')).toBeVisible();
});

test('the owner sees it posted, in the ledger and in the reports', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto(journalUrl);
  await expect(page.getByRole('heading', { level: 1, name: /^JV\/2026-27\/\d{5}$/ })).toBeVisible();
  await expect(page.getByText('Posted', { exact: true })).toBeVisible();

  await page.goto('/finance/accounts');
  await page.getByLabel('Company').selectOption({ label: companyName });
  await page.getByRole('link', { name: 'Bank', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '1100 · Bank' })).toBeVisible();
  await page.getByLabel('From', { exact: true }).fill('2026-04-01');
  await page.getByLabel('To', { exact: true }).fill('2026-04-30');
  await expect(page.getByRole('row').filter({ hasText: narration })).toContainText('25,000.00');
  await expect(page.getByRole('row').filter({ hasText: 'Closing balance' })).toContainText('25,000.00');

  await page.goto('/finance/reports');
  await page.getByLabel('Company').selectOption({ label: companyName });
  await page.getByLabel('As at').fill('2026-04-30');
  await expect(page.getByRole('row').filter({ hasText: 'Total' })).toContainText('25,000.00');
  await page.getByLabel('Report').selectOption('profit-and-loss');
  await page.getByLabel('From', { exact: true }).fill('2026-04-01');
  await page.getByLabel('To', { exact: true }).fill('2026-04-30');
  await expect(page.getByRole('row').filter({ hasText: /^Profit/ })).toContainText('25,000.00');
});
