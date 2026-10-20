/**
 * The scheduled sweeps endpoint: closed unless the secret matches, runs the sweeps against the real database,
 * and rejects job names it does not know.
 */
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { closeCron } from '@smart-hr/worker/cron';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cronHandler } from '../src/cron-handler.js';

const SECRET = 'test-cron-secret-0123456789';

interface Reply {
  status: number;
  body: { error?: string; jobs?: string[]; runs?: { job: string; ok: boolean }[] };
}

async function call(url: string, authorization?: string): Promise<Reply> {
  const req = Object.assign(new EventEmitter(), { url, headers: authorization ? { authorization } : {} });
  let status = 0;
  let body = '';
  const res = {
    set statusCode(value: number) {
      status = value;
    },
    setHeader: () => res,
    end: (text: string) => {
      body = text;
    },
  };
  await cronHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);
  return { status, body: JSON.parse(body) as Reply['body'] };
}

const saved = { ...process.env };

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
});

afterEach(() => {
  process.env.CRON_SECRET = saved.CRON_SECRET;
  if (saved.CRON_SECRET === undefined) delete process.env.CRON_SECRET;
});

afterAll(async () => {
  await closeCron();
});

describe('scheduled sweeps endpoint', () => {
  it('is closed when no secret is configured', async () => {
    delete process.env.CRON_SECRET;
    expect((await call('/api/cron', `Bearer ${SECRET}`)).status).toBe(503);
  });

  it('rejects a missing or wrong secret', async () => {
    expect((await call('/api/cron')).status).toBe(401);
    expect((await call('/api/cron', 'Bearer nope')).status).toBe(401);
    expect((await call('/api/cron', SECRET)).status).toBe(401);
  });

  it('rejects job names it does not know', async () => {
    const reply = await call('/api/cron?jobs=outbox,drop-tables', `Bearer ${SECRET}`);
    expect(reply.status).toBe(400);
    expect(reply.body.jobs).toEqual(['drop-tables']);
  });

  it('runs every sweep by default', async () => {
    const reply = await call('/api/cron', `Bearer ${SECRET}`);
    expect(reply.status).toBe(200);
    expect(reply.body.runs?.map((r) => r.job)).toEqual(['outbox', 'escalation', 'subscriptions', 'documents']);
    expect(reply.body.runs?.every((r) => r.ok)).toBe(true);
  });

  it('runs only the sweeps asked for', async () => {
    const reply = await call('/api/cron?jobs=documents', `Bearer ${SECRET}`);
    expect(reply.status).toBe(200);
    expect(reply.body.runs?.map((r) => r.job)).toEqual(['documents']);
  });
});
