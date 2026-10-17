/**
 * End-to-end authentication against the real web app, API, worker, PostgreSQL, Redis and Mailpit.
 * No mocks: every step goes through the same paths a user's browser would.
 */
import { generateTotpForTesting } from '@smart-hr/auth';
import { expect, test } from '@playwright/test';
import { account, clearEmailsTo, signIn, waitForEmail } from './support';

test.describe.configure({ mode: 'serial' });

test('a signed-out visitor is sent to sign-in and returned afterwards', async ({ page }) => {
  const admin = account('ADMIN');
  await page.goto('/account/security');
  await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Fsecurity/);

  await page.getByLabel('Work email').fill(admin.email);
  await page.getByLabel('Password', { exact: true }).fill(admin.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/account\/security$/);
  await expect(page.getByRole('heading', { name: 'Account and security' })).toBeVisible();
});

test('a wrong password shows one generic message and no session', async ({ page, context }) => {
  const admin = account('ADMIN');
  await signIn(page, admin.email, 'definitely not the password');
  await expect(page.getByRole('alert').filter({ hasText: 'couldn’t sign you in' })).toBeVisible();
  expect((await context.cookies()).find((c) => c.name === 'shr_session')).toBeUndefined();
});

test('the dashboard shows the organisation and live system status', async ({ page }) => {
  const admin = account('ADMIN');
  await signIn(page, admin.email, admin.password);
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
  await expect(page.getByText('Reachable')).toBeVisible({ timeout: 15_000 });
});

test('the session cookie is HttpOnly and SameSite=Lax', async ({ page, context }) => {
  const admin = account('ADMIN');
  await signIn(page, admin.email, admin.password);
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
  const session = (await context.cookies()).find((c) => c.name === 'shr_session');
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Lax');
  // Page scripts cannot read it.
  expect(await page.evaluate(() => document.cookie)).not.toContain('shr_session');
});

test('signing out ends the session, and protected pages need sign-in again', async ({ page }) => {
  const admin = account('ADMIN');
  await signIn(page, admin.email, admin.password);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?reason=signed-out/);
  await expect(page.getByRole('status').filter({ hasText: 'signed out' })).toBeVisible();

  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

test('password reset by email, single-use link, then sign-in with the new password', async ({ page }) => {
  const user = account('RESET');
  // This account also gets approval emails from other tests; start from an empty inbox, then wait for the link.
  await clearEmailsTo(user.email);
  await page.goto('/forgot-password');
  await page.getByLabel('Work email').fill(user.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'If an account exists' })).toBeVisible();

  const body = await waitForEmail(user.email, '/reset-password?token=');
  const link = /https?:\/\/\S+\/reset-password\?token=[A-Za-z0-9_-]+/.exec(body)?.[0];
  expect(link).toBeTruthy();

  const newPassword = `${user.password} renewed`;
  await page.goto(link!);
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirm new password').fill(newPassword);
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page).toHaveURL(/\/login\?reason=password-reset/);

  await signIn(page, user.email, newPassword);
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();

  // The link is spent.
  await page.goto(link!);
  await page.getByLabel('New password', { exact: true }).fill('yet another new passphrase');
  await page.getByLabel('Confirm new password').fill('yet another new passphrase');
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'invalid or has expired' })).toBeVisible();
});

test('two-step verification: enrol, then sign in with a code', async ({ page }) => {
  test.setTimeout(90_000);
  const user = account('MFA');
  await signIn(page, user.email, user.password);
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
  await page.goto('/account/security');
  await page.getByRole('button', { name: 'Set up authenticator app' }).click();

  await page.getByText('Can’t scan? Enter the key instead').click();
  const secret = (await page.locator('details code').textContent())!.trim();
  await page.getByLabel('Code from your app').fill(generateTotpForTesting(secret));
  await page.getByRole('button', { name: 'Turn on' }).click();

  const codes = page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem');
  await expect(codes).toHaveCount(10);
  await page.getByRole('button', { name: 'I’ve saved them' }).click();
  await expect(page.getByText('On', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, user.email, user.password);
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();

  // Codes are single-use: wait for the next 30-second step after the one used at enrolment.
  const nextStep = (Math.floor(Date.now() / 30_000) + 1) * 30_000;
  await page.waitForTimeout(nextStep - Date.now() + 500);
  await page.getByLabel('Verification code').fill(generateTotpForTesting(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
});

test('the account page lists this device and recent activity', async ({ page }) => {
  const admin = account('ADMIN');
  await signIn(page, admin.email, admin.password);
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
  await page.goto('/account/security');
  await expect(page.getByText('This device')).toBeVisible();
  await expect(page.getByText('Sign-in').first()).toBeVisible();
});
