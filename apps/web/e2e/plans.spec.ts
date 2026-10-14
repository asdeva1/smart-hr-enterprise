/**
 * Plans and subscriptions end to end. The PLATFORM account is a platform operator who owns a separate
 * organisation ("E2E Platform Org"), so these tests can change that organisation's plan without touching
 * the organisation other tests use. Re-runnable: each run restores what it changes.
 */
import { expect, test, type Page } from '@playwright/test';
import { account, signIn } from './support';

test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).toUpperCase();

async function signInAs(page: Page, who: 'ADMIN' | 'PLATFORM') {
  const user = account(who);
  await signIn(page, user.email, user.password);
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

test('an owner sees their plan, what it includes and usage against limits', async ({ page }) => {
  await signInAs(page, 'ADMIN');
  await nav(page).getByRole('link', { name: 'Plan and usage' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Plan and usage' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Enterprise plan' })).toBeVisible();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  await expect(page.getByText(/Members \(sign-in accounts\)/)).toBeVisible();
  // Organisation members can't reach the platform console.
  await expect(nav(page).getByRole('link', { name: 'Plan catalogue' })).toHaveCount(0);
});

test('an operator creates, prices and publishes a plan', async ({ page }) => {
  await signInAs(page, 'PLATFORM');
  await nav(page).getByRole('link', { name: 'Plan catalogue' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Plan catalogue' })).toBeVisible();

  await page.getByRole('button', { name: 'New plan' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Code').fill(`E2E${run}`);
  await dialog.getByLabel('Name').fill(`E2E plan ${run}`);
  await dialog.getByRole('button', { name: 'Create plan' }).click();
  await expect(page.getByText(`E2E plan ${run} created with an empty draft.`)).toBeVisible();

  // Publishing an empty plan is refused by the API.
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Add at least one feature before publishing')).toBeVisible();

  await page.getByLabel('Employee records and directory').check();
  await page.getByLabel('Leave types, balances and requests').check();
  await page.getByLabel('Trial days').fill('21');
  await page.getByRole('button', { name: 'Add price' }).click();
  await page.getByLabel('Amount').fill('99.50');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Draft v1 saved\./)).toBeVisible();

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('v1 published. It can no longer be changed.')).toBeVisible();
  await expect(page.getByText('Version 1 (published, frozen)')).toBeVisible();
  await expect(page.getByText('INR 99.5 / month per employee')).toBeVisible();
});

test('an operator moves an organisation to a smaller plan, and its members see the change', async ({
  page,
}) => {
  await signInAs(page, 'PLATFORM');
  await nav(page).getByRole('link', { name: 'Organisations' }).click();
  await page.getByRole('link', { name: 'E2E Platform Org' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Platform Org' })).toBeVisible();
  await page.getByRole('tab', { name: 'Subscription' }).click();

  await page.getByLabel('Plan version').selectOption({ label: 'Lite v1 (14-day trial)' });
  await page.getByLabel('Reason (recorded in history)').fill(`e2e ${run}`);
  await page.getByRole('button', { name: 'Change plan' }).click();
  await expect(page.getByText('Plan changed.')).toBeVisible();
  await expect(page.getByRole('cell', { name: `e2e ${run}` })).toBeVisible();

  // Suspend: the organisation becomes read-only, and says so to its members.
  await page.getByLabel('Reason for this change').fill('Payment dispute (e2e)');
  await page.getByRole('button', { name: 'Suspend', exact: true }).click();
  await expect(page.getByText('Suspended. The organisation is read-only.')).toBeVisible();
  await page.goto('/');
  await expect(page.getByText(/subscription is suspended/)).toBeVisible();

  // Put it back: Enterprise, active.
  await page.goto('/platform/organisations');
  await page.getByRole('link', { name: 'E2E Platform Org' }).click();
  await page.getByRole('tab', { name: 'Subscription' }).click();
  await page.getByRole('button', { name: 'Reactivate' }).click();
  await expect(page.getByText('Reactivated.')).toBeVisible();
  await page.getByLabel('Plan version').selectOption({ label: 'Enterprise v1' });
  await page.getByRole('button', { name: 'Change plan' }).click();
  await expect(page.getByText('Plan changed.')).toBeVisible();
  await page.goto('/');
  await expect(page.getByText(/subscription is suspended/)).toHaveCount(0);
});
