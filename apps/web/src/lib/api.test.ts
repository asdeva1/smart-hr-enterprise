import { describe, expect, it, vi } from 'vitest';
import { ApiUnreachableError, fetchReadiness } from './api';

function respond(status: number, body: unknown) {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

describe('fetchReadiness', () => {
  it('returns the report when the API is ready', async () => {
    const report = { status: 'ok', checks: { database: 'up', redis: 'up' } };
    await expect(fetchReadiness(respond(200, report))).resolves.toEqual(report);
  });

  it('still returns the report when a dependency is down (503)', async () => {
    const report = { status: 'unavailable', checks: { database: 'up', redis: 'down' } };
    await expect(fetchReadiness(respond(503, report))).resolves.toEqual(report);
  });

  it('treats network failures and other errors as unreachable', async () => {
    await expect(
      fetchReadiness(vi.fn(() => Promise.reject(new TypeError('fetch failed')))),
    ).rejects.toBeInstanceOf(ApiUnreachableError);
    await expect(fetchReadiness(respond(500, {}))).rejects.toBeInstanceOf(ApiUnreachableError);
  });
});
