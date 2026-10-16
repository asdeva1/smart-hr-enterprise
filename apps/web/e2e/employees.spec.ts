/**
 * Employee records end to end: add an employee through the form, record a promotion, keep identity details
 * masked until the owner asks to see them, import a spreadsheet and find people on the organisation chart.
 * Each run uses its own company and codes, so it is re-runnable.
 */
import { expect, test, type Page } from '@playwright/test';
import { account, signIn } from './support';

test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).toUpperCase();
const companyCode = `EMPCO-${run}`;
const companyName = `Employees Co ${run}`;
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function signInAsOwner(page: Page) {
  const admin = account('ADMIN');
  await signIn(page, admin.email, admin.password);
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
}

/** Calls the API as the signed-in browser (same cookies, CSRF header), to set up reference data quickly. */
async function api(page: Page, method: 'POST' | 'PUT', path: string, data: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'shr_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, {
    method,
    data,
    headers: { 'x-csrf-token': csrf, origin: 'http://localhost:3000' },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json() as Promise<{ id: string }>;
}

test('an owner adds an employee and records a promotion', async ({ page }) => {
  await signInAsOwner(page);
  await api(page, 'POST', '/v1/org/companies', {
    code: companyCode,
    name: companyName,
    country: 'IN',
    baseCurrency: 'INR',
    timezone: 'Asia/Kolkata',
  });
  for (const [code, name] of [
    [`NURSE-${run}`, `Staff nurse ${run}`],
    [`SRN-${run}`, `Senior nurse ${run}`],
  ]) {
    await api(page, 'POST', '/v1/master-data/designation', { code, name });
  }

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Employees' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Employees' })).toBeVisible();
  await page.getByRole('link', { name: 'Add employee' }).click();

  await page.getByLabel('First name', { exact: true }).fill('Meera');
  await page.getByLabel('Last name', { exact: true }).fill(`Iyer ${run}`);
  await page.getByRole('button', { name: 'Add employee' }).click();
  await expect(page.getByText('Choose a company')).toBeVisible();

  await page.getByLabel('Company').selectOption({ label: companyName });
  await page.getByLabel('Designation (optional)').selectOption({ label: `Staff nurse ${run}` });
  await page.getByLabel('Mobile (optional)').fill('+91 98765 43210');
  await page.getByRole('button', { name: 'Add employee' }).click();

  await expect(page.getByRole('heading', { level: 1, name: `Meera Iyer ${run}` })).toBeVisible();
  await expect(page.getByText('Employee added.')).toBeVisible();
  await expect(page.getByText(/^EMP-\d{4}/)).toBeVisible();

  await page.getByLabel('Change employment').selectOption('promotion');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Designation').selectOption({ label: `Senior nurse ${run}` });
  await dialog.getByLabel('Note (optional, kept in the history)').fill('Annual review');
  await dialog.getByRole('button', { name: 'Record promotion' }).click();
  await expect(page.getByText('Promotion recorded.')).toBeVisible();

  await page.getByRole('tab', { name: 'History' }).click();
  const history = page.getByRole('list', { name: 'Employment history' });
  await expect(history.getByText('Promoted')).toBeVisible();
  await expect(history.getByText(`Designation: Staff nurse ${run} → Senior nurse ${run}`)).toBeVisible();
  await expect(history.getByText('“Annual review”')).toBeVisible();
});

test('identity details stay masked until the owner asks to see them', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto('/employees');
  await page.getByLabel('Search').fill(`Iyer ${run}`);
  await page.getByRole('link', { name: `Meera Iyer ${run}` }).click();
  await page.getByRole('tab', { name: 'Identity and bank' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('PAN').fill('abcde1234x');
  await dialog.getByLabel('IFSC').fill('HDFC0001234');
  await dialog.getByLabel('Aadhaar').fill('1234');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Use the 12-digit Aadhaar number')).toBeVisible();
  await dialog.getByLabel('Aadhaar').fill('');
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('Identity and bank details saved.')).toBeVisible();
  await expect(page.getByText('•••• 234X')).toBeVisible();
  await expect(page.getByText('ABCDE1234X')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show full numbers' }).click();
  await expect(page.getByText('ABCDE1234X')).toBeVisible();
});

test('an owner imports a spreadsheet and sees the reporting lines', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto('/employees/import');
  await expect(page.getByRole('heading', { level: 1, name: 'Import employees' })).toBeVisible();

  const header = 'employee_code,first_name,last_name,date_of_joining,company_code,manager_code';
  const bad = [header, `LEAD-${run},Lakshmi,Pillai,2026-01-05,NO-SUCH-CO,`].join('\n');
  await page
    .getByLabel('CSV file')
    .setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from(bad) });
  await page.getByRole('button', { name: 'Check file' }).click();
  await expect(page.getByText('1 problem to fix.', { exact: false })).toBeVisible();
  await expect(page.getByRole('cell', { name: /No active company with code NO-SUCH-CO/ })).toBeVisible();

  const good = [
    header,
    `LEAD-${run},Lakshmi,Pillai ${run},2026-01-05,${companyCode},`,
    `MEM-${run},Vikram,Das ${run},2026-01-06,${companyCode},LEAD-${run}`,
  ].join('\n');
  await page
    .getByLabel('CSV file')
    .setInputFiles({ name: 'good.csv', mimeType: 'text/csv', buffer: Buffer.from(good) });
  await page.getByRole('button', { name: 'Check file' }).click();
  await expect(page.getByText('All 2 rows are ready to import.')).toBeVisible();
  await page.getByRole('button', { name: 'Import 2 employees' }).click();
  await expect(page.getByText('Imported 2 employees.')).toBeVisible();

  await page.getByRole('link', { name: 'Organisation chart' }).click();
  await page.getByLabel('Find someone').fill(`Das ${run}`);
  const tree = page.getByRole('tree', { name: 'Organisation chart' });
  await expect(tree.getByRole('link', { name: `Lakshmi Pillai ${run}` })).toBeVisible();
  await expect(tree.getByRole('link', { name: `Vikram Das ${run}` })).toBeVisible();
});
