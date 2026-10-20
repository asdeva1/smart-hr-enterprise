import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { assertRestrictedRuntimeRole } from '@smart-hr/database';
import { CRON_JOBS, isCronJob, runCronJobs, type CronJob } from '@smart-hr/worker/cron';
import { useRestrictedDatabaseRole } from './serverless-env.js';

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function authorised(req: IncomingMessage, secret: string): boolean {
  const given = Buffer.from(req.headers.authorization ?? '');
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

let guarded = false;

/**
 * Runs the background sweeps (email outbox, approval escalation, subscription expiry, document reminders).
 * Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`; any other scheduler can do the same.
 * `?jobs=outbox,documents` limits the run; with no filter every sweep runs.
 */
export async function cronHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return send(res, 503, { error: 'cron_not_configured' });
  if (!authorised(req, secret)) return send(res, 401, { error: 'unauthorised' });

  const requested = new URL(req.url ?? '/', 'http://localhost').searchParams.get('jobs');
  const names = requested
    ? requested
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean)
    : [...CRON_JOBS];
  const unknown = names.filter((n) => !isCronJob(n));
  if (unknown.length > 0) return send(res, 400, { error: 'unknown_job', jobs: unknown });

  try {
    useRestrictedDatabaseRole();
    if (!guarded) {
      await assertRestrictedRuntimeRole(process.env.DATABASE_URL ?? '');
      guarded = true;
    }
    const runs = await runCronJobs(names as CronJob[]);
    return send(res, runs.every((r) => r.ok) ? 200 : 500, { runs });
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
    return send(res, 503, { error: 'cron_failed', message: message.slice(0, 300) });
  }
}
