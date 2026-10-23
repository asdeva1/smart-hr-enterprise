// Runs during the Vercel build, after the workspace is built: gives the restricted runtime role its
// password and applies pending migrations as the database owner. Never prints connection strings.
import { spawnSync } from 'node:child_process';
import { ensureRuntimeRole } from '@smart-hr/database';

const owner = process.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_URL_UNPOOLED;
const password = process.env.APP_DB_PASSWORD;

if (!owner || !password) {
  console.log(
    '[prepare] DATABASE_URL_UNPOOLED or APP_DB_PASSWORD is not set; skipping role setup and migrations.',
  );
  process.exit(0);
}

await ensureRuntimeRole(owner, password);
console.log('[prepare] runtime role ready');

const result = spawnSync('pnpm', ['--filter', '@smart-hr/database', 'db:migrate:deploy'], {
  cwd: new URL('../..', import.meta.url).pathname,
  env: { ...process.env, DATABASE_MIGRATOR_URL: owner },
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status ?? 1);

// Bring the plan catalogue and every organisation's built-in roles up to date, so a release that adds a plan
// (such as SmartHR Launch) or a permission works without anyone running commands by hand. Both are idempotent:
// they only add what is missing and never change a plan an operator has edited.
for (const script of ['sync-plan-catalogue.js', 'sync-system-roles.js']) {
  const sync = spawnSync('node', [`dist/cli/${script}`], {
    cwd: new URL('.', import.meta.url).pathname,
    env: { ...process.env, DATABASE_MIGRATOR_URL: owner },
    stdio: 'inherit',
  });
  if (sync.status !== 0) {
    // A failed catalogue sync must not stop the release; the app still starts and the log says why.
    console.log(`[prepare] ${script} failed (exit ${sync.status ?? 'unknown'}); continuing.`);
  }
}
process.exit(0);
