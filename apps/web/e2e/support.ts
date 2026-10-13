import { expect, type Page } from '@playwright/test';

/** Accounts created by the CI bootstrap step. Passwords are generated per run and passed in the environment. */
export function account(name: 'ADMIN' | 'RESET' | 'MFA') {
  const email = process.env[`E2E_${name}_EMAIL`];
  const password = process.env[`E2E_${name}_PASSWORD`];
  if (!email || !password) throw new Error(`E2E_${name}_EMAIL and E2E_${name}_PASSWORD must be set`);
  return { email, password };
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

/** Waits for the newest email to an address in Mailpit and returns its plain-text body. */
export async function latestEmailTo(address: string): Promise<string> {
  let text = '';
  await expect
    .poll(
      async () => {
        const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
        const { messages } = (await search.json()) as { messages: { ID: string }[] };
        if (!messages?.length) return false;
        const message = await fetch(`${MAILPIT}/api/v1/message/${messages[0]!.ID}`);
        text = ((await message.json()) as { Text: string }).Text;
        return true;
      },
      { timeout: 20_000, intervals: [500] },
    )
    .toBe(true);
  return text;
}

/** Waits for an email to an address whose text contains `marker` (e.g. a per-run title), and returns its text. */
export async function waitForEmail(address: string, marker: string, timeout = 30_000): Promise<string> {
  let text = '';
  await expect
    .poll(
      async () => {
        const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
        const { messages } = (await search.json()) as { messages: { ID: string }[] | null };
        for (const { ID } of (messages ?? []).slice(0, 10)) {
          const message = await fetch(`${MAILPIT}/api/v1/message/${ID}`);
          const body = ((await message.json()) as { Text: string }).Text;
          if (body.includes(marker)) {
            text = body;
            return true;
          }
        }
        return false;
      },
      { timeout, intervals: [1_000] },
    )
    .toBe(true);
  return text;
}
