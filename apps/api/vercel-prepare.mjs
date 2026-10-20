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
process.exit(result.status ?? 1);
