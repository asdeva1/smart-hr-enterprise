/** The app shell at phone width: the menu folds away so each page starts at the top of the screen. */
import { expect, test } from '@playwright/test';
import { account, signIn } from './support';

test.use({ viewport: { width: 390, height: 844 } });

test('on a phone the menu is folded away until opened', async ({ page }) => {
  const admin = account('ADMIN');
  await signIn(page, admin.email, admin.password);
  const heading = page.getByRole('heading', { level: 1, name: /Welcome/ });
  await expect(heading).toBeInViewport();

  const nav = page.getByRole('navigation', { name: 'Main' });
  const approvals = nav.getByRole('link', { name: 'Approvals' });
  await expect(approvals).toBeHidden();

  const toggle = nav.getByRole('button', { name: 'Menu' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await approvals.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Approvals' })).toBeInViewport();
  await expect(nav.getByRole('link', { name: 'Approvals' })).toBeHidden();
});
