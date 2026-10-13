/**
 * Organisation settings and reference lists end to end. The ADMIN account is an organisation owner.
 * Written to be re-runnable: it works whatever an earlier run left behind.
 */
import { expect, test, type Page } from '@playwright/test';
import { account, signIn } from './support';

test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).toUpperCase();

async function signInAsOwner(page: Page) {
  const admin = account('ADMIN');
  await signIn(page, admin.email, admin.password);
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
}

test('an owner changes organisation settings, with validation', async ({ page }) => {
  await signInAsOwner(page);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Organisation settings' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Organisation settings' })).toBeVisible();

  const currency = page.getByLabel('Default currency');
  await currency.fill('rupees');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Use a three-letter ISO currency code, e.g. INR')).toBeVisible();

  await currency.fill('usd');
  await page.getByLabel('Financial year starts in').selectOption({ label: 'January' });
  await page.getByRole('button', { name: 'Save settings' }).click();
  // "Nothing changed" if an interrupted earlier run left these values.
  await expect(page.getByText(/Saved \d setting\(s\)\.|Nothing changed\./)).toBeVisible();
  // Shown as the server stored it.
  await expect(currency).toHaveValue('USD');

  await page.reload();
  await expect(page.getByLabel('Default currency')).toHaveValue('USD');
  await expect(page.getByLabel('Financial year starts in')).toHaveValue('1');

  // Put the defaults back for other tests.
  await page.getByLabel('Default currency').fill('INR');
  await page.getByLabel('Financial year starts in').selectOption({ label: 'April' });
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText(/Saved \d setting\(s\)\./)).toBeVisible();
});

test('an owner maintains a reference list', async ({ page }) => {
  await signInAsOwner(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Reference lists' }).click();
  await page.getByRole('tab', { name: 'Designations' }).click();
  const panel = page.getByRole('region', { name: 'Designations' });

  await panel.getByRole('button', { name: 'Add value' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Code').fill(`sde ${run}`);
  await dialog.getByLabel('Name').fill('Software Engineer');
  await dialog.getByRole('button', { name: 'Add value' }).click();
  await expect(dialog.getByText('Use up to 30 letters, digits, - or _')).toBeVisible();
  await dialog.getByLabel('Code').fill(`sde-${run}`);
  await dialog.getByRole('button', { name: 'Add value' }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByRole('cell', { name: `SDE-${run}` })).toBeVisible();

  // Duplicate codes are refused on the field.
  await panel.getByRole('button', { name: 'Add value' }).click();
  await dialog.getByLabel('Code').fill(`SDE-${run}`);
  await dialog.getByLabel('Name').fill('Duplicate');
  await dialog.getByRole('button', { name: 'Add value' }).click();
  await expect(dialog.getByText(/Already used in this list/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  const row = panel.getByRole('row', { name: new RegExp(`SDE-${run}`) });
  await row.getByRole('button', { name: 'Edit Software Engineer' }).click();
  await expect(dialog.getByLabel('Code')).toBeDisabled();
  await dialog.getByLabel('Name').fill(`Engineer ${run}`);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('cell', { name: `Engineer ${run}`, exact: true })).toBeVisible();

  await row.getByRole('button', { name: `Archive Engineer ${run}` }).click();
  await expect(panel.getByRole('cell', { name: `SDE-${run}` })).toBeHidden();
  await panel.getByLabel(/Show archived/).check();
  await expect(
    panel.getByRole('row', { name: new RegExp(`SDE-${run}`) }).getByText('Archived'),
  ).toBeVisible();
});

test('suggested values are added once', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto('/admin/master-data');
  await page.getByRole('tab', { name: 'Exit reasons' }).click();
  const panel = page.getByRole('region', { name: 'Exit reasons' });
  const add = panel.getByRole('button', { name: /^Add \d+ suggested$/ });
  if (await add.isVisible()) {
    await add.click();
    await expect(panel.getByText(/Added \d+ suggested value/)).toBeVisible();
  }
  await expect(panel.getByRole('cell', { name: 'Resignation', exact: true })).toBeVisible();
  await expect(add).toBeHidden();
});
