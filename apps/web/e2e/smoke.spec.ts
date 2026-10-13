import { expect, test } from '@playwright/test';

test('dashboard shell loads and reports live API status', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  // In CI the API is running, so the status card must show it as reachable.
  await expect(page.getByText('Reachable')).toBeVisible({ timeout: 15_000 });
});

test('sign-in page is reachable and clearly not active yet', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('Phase 2');
});
