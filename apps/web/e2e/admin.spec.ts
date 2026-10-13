/**
 * Organisation administration end to end: real web app, API, worker, PostgreSQL, Redis and Mailpit.
 * The ADMIN account is an organisation owner (created by the CI bootstrap step).
 */
import { expect, test, type Page } from '@playwright/test';
import { account, latestEmailTo, signIn } from './support';

test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36);

async function signInAsOwner(page: Page) {
  const admin = account('ADMIN');
  await signIn(page, admin.email, admin.password);
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
}

test('an owner builds companies, branches and nested departments', async ({ page }) => {
  await signInAsOwner(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Organisation' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Organisation' })).toBeVisible();

  // Company — with a validation error first.
  await page.getByRole('button', { name: 'Add company' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Code').fill(`e2e-${run}`);
  await dialog.getByLabel('Name', { exact: true }).fill('E');
  await dialog.getByRole('button', { name: 'Add company' }).click();
  await expect(dialog.getByText('Use at least 2 characters')).toBeVisible();
  await dialog.getByLabel('Name', { exact: true }).fill(`Acme ${run}`);
  await dialog.getByRole('button', { name: 'Add company' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('cell', { name: `E2E-${run}`.toUpperCase() })).toBeVisible();

  // Branch.
  await page.getByRole('tab', { name: 'Branches' }).click();
  await page.getByRole('button', { name: 'Add branch' }).click();
  await dialog.getByLabel('Company').selectOption({ label: `Acme ${run}` });
  await dialog.getByLabel('Code').fill(`blr-${run}`);
  await dialog.getByLabel('Name', { exact: true }).fill(`Bengaluru ${run}`);
  await dialog.getByRole('button', { name: 'Add branch' }).click();
  await expect(page.getByRole('cell', { name: `Bengaluru ${run}`, exact: true })).toBeVisible();

  // Department and a sub-department.
  await page.getByRole('tab', { name: 'Departments' }).click();
  await page.getByRole('button', { name: 'Add department' }).click();
  await dialog.getByLabel('Company').selectOption({ label: `Acme ${run}` });
  await dialog.getByLabel('Code').fill(`ops-${run}`);
  await dialog.getByLabel('Name', { exact: true }).fill(`Operations ${run}`);
  await dialog.getByRole('button', { name: 'Add department' }).click();
  await expect(page.getByRole('cell', { name: `Operations ${run}`, exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Add department' }).click();
  await dialog.getByLabel('Company').selectOption({ label: `Acme ${run}` });
  await dialog.getByLabel('Inside department').selectOption({ label: `Operations ${run}` });
  await dialog.getByLabel('Code').fill(`coding-${run}`);
  await dialog.getByLabel('Name', { exact: true }).fill(`Coding ${run}`);
  await dialog.getByRole('button', { name: 'Add department' }).click();
  await expect(page.getByRole('cell', { name: `Coding ${run}`, exact: true })).toBeVisible();
});

test('an owner invites someone, who joins from the email with only their role’s access', async ({
  page,
  browser,
}) => {
  const email = `invitee-${run}@e2e.smarthr.test`;
  await signInAsOwner(page);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'People and access' })
    .click();
  await page.getByRole('button', { name: 'Invite someone' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Invited Person');
  await dialog.getByLabel('Work email').fill(email);
  await dialog.getByLabel('Role (optional)').selectOption({ label: 'Member' });
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Invitation sent' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Invited Person' })).toBeVisible();

  // The invitee, in their own browser.
  const body = await latestEmailTo(email);
  const link = /https?:\/\/\S+\/reset-password\?token=[A-Za-z0-9_-]+&invite=1/.exec(body)?.[0];
  expect(link, 'invitation email contains a set-up link').toBeTruthy();

  const invitee = await (await browser.newContext()).newPage();
  await invitee.goto(link!);
  await expect(invitee.getByRole('heading', { name: 'Set up your account' })).toBeVisible();
  const password = `first password ${run}`;
  await invitee.getByLabel('New password', { exact: true }).fill(password);
  await invitee.getByLabel('Confirm new password').fill(password);
  await invitee.getByRole('button', { name: 'Set new password' }).click();
  await expect(invitee.getByRole('status').filter({ hasText: 'Your account is ready' })).toBeVisible();

  await signIn(invitee, email, password);
  await expect(invitee.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
  const nav = invitee.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Organisation' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'People and access' })).toHaveCount(0);

  // Going there directly shows a no-access page; the API refuses the data regardless.
  await invitee.goto('/admin/people');
  await expect(invitee.getByRole('heading', { name: 'You don’t have access to this page' })).toBeVisible();
});

test('an owner gives a member a role for one company only', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto('/admin/people');
  await page.getByRole('link', { name: 'Invited Person' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Invited Person' })).toBeVisible();

  await page.getByLabel('Role', { exact: true }).selectOption({ label: 'Auditor' });
  await page.getByLabel('Applies to').selectOption({ label: 'One company' });
  await page.getByLabel('Company', { exact: true }).selectOption({ label: `Acme ${run}` });
  await page.getByRole('button', { name: 'Add role' }).click();
  await expect(page.getByText(`Company: Acme ${run}`)).toBeVisible();

  // The change is in the audit log.
  await page.goto('/admin/audit');
  await page.getByLabel('Show').selectOption({ label: 'People, roles and ownership' });
  await expect(page.getByRole('cell', { name: /access › role › assign/i }).first()).toBeVisible();
});
