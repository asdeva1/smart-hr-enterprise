/**
 * Approvals and notifications end to end: real web app, API, worker, PostgreSQL, Redis and Mailpit.
 * No module submits requests until Leave (Phase 10), so this file seeds two pending requests with the
 * database owner connection, exactly as the engine would write them. Everything after that goes through
 * the browser, the API and the worker (whose outbox sweep emails the requester).
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { account, signIn, waitForEmail } from './support';

test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36);
const titles = { back: `Conference trip ${run}`, approve: `Client visit ${run}` };
const ids: Record<keyof typeof titles, string> = { back: randomUUID(), approve: randomUUID() };

test.beforeAll(async () => {
  const url = process.env.DATABASE_MIGRATOR_URL;
  if (!url) throw new Error('DATABASE_MIGRATOR_URL must be set to seed approval requests');
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    const admin = account('ADMIN').email;
    const requester = account('RESET').email;
    const members = await db.query<{ email: string; id: string; tenant_id: string }>(
      `SELECT u.email, m.id, m.tenant_id FROM tenant_membership m
         JOIN app_user u ON u.id = m.user_id JOIN tenant t ON t.id = m.tenant_id
        WHERE t.slug = 'e2e' AND u.email = ANY($1)`,
      [[admin, requester]],
    );
    const by = (email: string) => members.rows.find((r) => r.email === email)!;
    const tenantId = by(admin).tenant_id;
    const adminUser = await db.query<{ id: string }>('SELECT id FROM app_user WHERE email = $1', [admin]);

    await db.query('BEGIN');
    const policyId = randomUUID();
    await db.query(
      `INSERT INTO approval_policy (id, tenant_id, subject_type, version, name, definition, is_active, created_at)
       VALUES ($1, $2, 'travel_request', 1000 + (SELECT count(*) FROM approval_policy WHERE tenant_id = $2), $3, $4, false, now())`,
      [
        policyId,
        tenantId,
        `E2E travel ${run}`,
        JSON.stringify({
          stages: [{ name: 'Owners', mode: 'ANY', approvers: [{ type: 'OWNERS' }] }],
          distinctApprovers: true,
        }),
      ],
    );
    for (const key of ['back', 'approve'] as const) {
      await db.query(
        `INSERT INTO approval_request (id, tenant_id, policy_id, subject_type, subject_id, title, amount, currency,
            scope_type, scope_id, requested_by_membership_id, updated_at)
         VALUES ($1, $2, $3, 'travel_request', $4, $5, 18500.5, 'INR', 'TENANT', $2, $6, now())`,
        [ids[key], tenantId, policyId, randomUUID(), titles[key], by(requester).id],
      );
      await db.query(
        `INSERT INTO approval_task (id, tenant_id, request_id, round, stage, stage_name, assignee_membership_id)
         VALUES ($1, $2, $3, 1, 0, 'Owners', $4)`,
        [randomUUID(), tenantId, ids[key], by(admin).id],
      );
      await db.query(
        `INSERT INTO notification (id, tenant_id, recipient_user_id, category, title, body, link)
         VALUES ($1, $2, $3, 'approval.assigned', $4, $5, $6)`,
        [
          randomUUID(),
          tenantId,
          adminUser.rows[0]!.id,
          `E2E RESET needs your approval`,
          titles[key],
          `/approvals/${ids[key]}`,
        ],
      );
    }
    await db.query('COMMIT');
  } finally {
    await db.end();
  }
});

async function signInAsOwner(page: Page) {
  const admin = account('ADMIN');
  await signIn(page, admin.email, admin.password);
  await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
}

test('an approver opens a request from the bell and sends it back with a reason', async ({ page }) => {
  await signInAsOwner(page);
  const bell = page.getByRole('button', { name: /Notifications, \d+ unread/ });
  await bell.click();
  const panel = page.getByRole('region', { name: 'Notifications' });
  await panel.getByRole('button', { name: new RegExp(titles.back) }).click();
  await expect(page).toHaveURL(new RegExp(`/approvals/${ids.back}$`));
  await expect(page.getByRole('heading', { level: 1, name: titles.back })).toBeVisible();
  await expect(page.getByText('INR 18,500.50')).toBeVisible();

  // A reason is required for anything but approval.
  const decision = page.getByRole('region', { name: 'Your decision' });
  await decision.getByLabel('Send back for changes').check();
  await decision.getByRole('button', { name: 'Send back' }).click();
  await expect(decision.getByText('Say why, so the requester knows what to do')).toBeVisible();
  await decision.getByLabel('Reason').fill('Please attach the agenda');
  await decision.getByRole('button', { name: 'Send back' }).click();

  await expect(page.getByText('You sent this request back.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your decision' })).toBeHidden();
  await expect(page.getByText('Please attach the agenda')).toBeVisible();

  // The worker's outbox sweep emails the requester.
  const email = await waitForEmail(account('RESET').email, titles.back);
  expect(email).toContain('Please attach the agenda');
  expect(email).toContain(`/approvals/${ids.back}`);
});

test('an approver approves from the inbox', async ({ page }) => {
  await signInAsOwner(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Approvals' }).click();
  await expect(page.getByRole('tab', { name: 'Waiting for me', selected: true })).toBeVisible();
  await expect(page.getByRole('link', { name: titles.back })).toBeHidden();
  await page.getByRole('link', { name: titles.approve }).click();

  await page.getByRole('region', { name: 'Your decision' }).getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('You approved this request.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: titles.approve })).toBeVisible();

  await page.getByRole('link', { name: '← Approvals' }).click();
  await expect(page.getByRole('link', { name: titles.approve })).toBeHidden();
});

test('an owner publishes a two-stage policy with an amount threshold', async ({ page }) => {
  await signInAsOwner(page);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Approval policies' })
    .click();
  await page.getByRole('button', { name: 'Edit Expense claim policy' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Stage name').fill('Manager');
  await dialog.getByRole('button', { name: 'Add stage' }).click();
  const second = dialog.getByRole('group', { name: 'Stage 2' });
  await second.getByLabel('Stage name').fill('Finance');
  await second.getByLabel('Who must approve').selectOption('ALL');
  await second.getByLabel('Only from amount').fill('fifty');
  await dialog.getByRole('button', { name: 'Publish new version' }).click();
  await expect(dialog.getByText(/Stage 2: Use a positive amount/)).toBeVisible();

  await second.getByLabel('Only from amount').fill('50000');
  await second.getByLabel('Approver type').selectOption('ROLE');
  await second.getByLabel('Role').selectOption({ label: 'Organisation administrator' });
  await dialog.getByRole('button', { name: 'Publish new version' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Expense claim: version \d+ published\./)).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Manager → Finance' })).toBeVisible();
});

test('a member chooses email notifications and delegates approvals', async ({ page }) => {
  await signInAsOwner(page);
  await page.getByRole('link', { name: /Account and security/ }).click();

  const prefs = page.getByRole('region', { name: 'Email notifications' });
  const overdue = prefs.getByLabel('An approval I own is overdue');
  await expect(overdue).toBeChecked();
  await overdue.uncheck();
  await expect(overdue).not.toBeChecked();
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Email notifications' }).getByLabel('An approval I own is overdue'),
  ).not.toBeChecked();
  await page
    .getByRole('region', { name: 'Email notifications' })
    .getByLabel('An approval I own is overdue')
    .check();

  const away = page.getByRole('region', { name: 'Approvals while you’re away' });
  await away.getByRole('button', { name: 'Delegate' }).click();
  await expect(away.getByText('Choose who approves for you')).toBeVisible();
  await away.getByLabel('Delegate to').selectOption({ label: 'E2E RESET' });
  await away.getByLabel('Reason (optional)').fill(`Offsite ${run}`);
  await away.getByRole('button', { name: 'Delegate' }).click();
  await expect(away.getByText('Delegation saved.', { exact: false })).toBeVisible();
  await expect(away.getByText(`· Offsite ${run}`)).toBeVisible();
  await away.getByRole('button', { name: 'End delegation to E2E RESET' }).first().click();
  await expect(away.getByText(`· Offsite ${run}`)).toBeHidden();
});
