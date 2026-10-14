/**
 * Organisation onboarding and lifecycle end to end: an operator provisions an organisation, its owner
 * accepts the emailed invitation, sets branding and exports data, then the operator offboards it.
 * Every run creates its own organisation (unique slug), so it is re-runnable.
 */
import { expect, test, type Page } from '@playwright/test';
import { account, latestEmailTo, signIn } from './support';

test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36);
const orgName = `E2E Onboard ${run}`;
const slug = `e2e-onboard-${run}`;
const ownerEmail = `owner-${run}@e2e.example.com`;
const ownerPassword = `Correct horse battery ${run}!`;

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

async function signInAsOperator(page: Page) {
  const user = account('PLATFORM');
  await signIn(page, user.email, user.password);
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
}

async function openOrganisation(page: Page) {
  await page.goto('/platform/organisations');
  await page.getByRole('link', { name: orgName }).click();
  await expect(page.getByRole('heading', { level: 1, name: orgName })).toBeVisible();
}

test('an operator provisions an organisation and its owner is invited', async ({ page }) => {
  await signInAsOperator(page);
  await nav(page).getByRole('link', { name: 'Organisations' }).click();
  await page.getByRole('button', { name: 'New organisation' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Organisation name').fill(orgName);
  await expect(dialog.getByLabel('Address')).toHaveValue(slug);
  await dialog.getByLabel('Owner’s name').fill('Onboarding Owner');
  await dialog.getByLabel('Owner’s email').fill(ownerEmail);
  await dialog.getByLabel('Plan (optional)').selectOption({ label: 'Pro v1' });
  await dialog.getByRole('button', { name: 'Create organisation' }).click();

  await expect(page.getByRole('heading', { level: 1, name: orgName })).toBeVisible();
  await expect(page.getByText('The owner has been emailed a link to set their password.')).toBeVisible();
  await expect(page.getByText(`Onboarding Owner · ${ownerEmail}`)).toBeVisible();

  // The same address can't be used twice.
  await page.goto('/platform/organisations');
  await page.getByRole('button', { name: 'New organisation' }).click();
  await page.getByRole('dialog').getByLabel('Organisation name').fill(orgName);
  await page.getByRole('dialog').getByLabel('Owner’s name').fill('Someone Else');
  await page.getByRole('dialog').getByLabel('Owner’s email').fill(`other-${ownerEmail}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Create organisation' }).click();
  await expect(page.getByRole('dialog').getByText(/already/i)).toBeVisible();
});

test('the owner accepts the invitation, brands the organisation and exports its data', async ({ page }) => {
  const email = await latestEmailTo(ownerEmail);
  const link = /https?:\/\/\S+reset-password\?\S+/.exec(email)?.[0];
  expect(link).toBeTruthy();
  await page.goto(new URL(link!).pathname + new URL(link!).search);
  await page.getByLabel('New password', { exact: true }).fill(ownerPassword);
  await page.getByLabel('Confirm new password').fill(ownerPassword);
  await page.getByRole('button', { name: 'Set new password' }).click();

  await signIn(page, ownerEmail, ownerPassword);
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();

  await nav(page).getByRole('link', { name: 'Branding' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Branding' })).toBeVisible();
  await page.getByLabel('Main colour').fill('#ffff00');
  await page.getByRole('button', { name: 'Save branding' }).click();
  await expect(page.getByText(/too light for white text/)).toBeVisible();
  await page.getByLabel('Display name').fill(`Onboard ${run}`);
  await page.getByLabel('Main colour').fill('#1d4ed8');
  await page.getByRole('button', { name: 'Save branding' }).click();
  await expect(page.getByText(/Branding saved/)).toBeVisible();
  await expect(nav(page).getByText(`Onboard ${run}`, { exact: true })).toBeVisible();

  // The owner signed in moments ago, which counts as recent authentication, so no password prompt.
  await nav(page).getByRole('link', { name: 'Your data' }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download export' }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/^smart-hr-export-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.getByText(/Export downloaded/)).toBeVisible();
});

test('an operator offboards the organisation and its members become read-only', async ({ browser }) => {
  const operator = await browser.newPage();
  await signInAsOperator(operator);
  await openOrganisation(operator);
  await operator
    .getByLabel('Reason (recorded in the organisation’s audit log)')
    .fill('Customer leaving (e2e)');
  await operator.getByRole('button', { name: 'Start offboarding' }).click();
  await expect(operator.getByText(/Offboarding started/)).toBeVisible();

  const owner = await browser.newPage();
  await signIn(owner, ownerEmail, ownerPassword);
  await expect(owner.getByText(/This organisation is being closed/)).toBeVisible();
  await owner.goto('/admin/branding');
  await expect(owner.getByRole('button', { name: 'Save branding' })).toBeDisabled();

  // Archive needs the address typed out, then ends all access.
  await operator.getByLabel('Reason (recorded in the organisation’s audit log)').fill('Contract ended (e2e)');
  const archive = operator.getByRole('button', { name: 'Archive organisation' });
  await expect(archive).toBeDisabled();
  await operator.getByLabel(`Type ${slug} to archive`).fill(slug);
  await archive.click();
  await expect(operator.getByText(/Archived\./)).toBeVisible();
  await expect(operator.getByText('Archived — no access')).toBeVisible();

  await owner.goto('/');
  await expect(owner.getByText(/This organisation is being closed/)).toHaveCount(0);
  await operator.close();
  await owner.close();
});
