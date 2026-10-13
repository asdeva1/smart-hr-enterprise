import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, ApiUnreachableError, apiFetch, fetchReadiness, safeNextPath } from './api';

function respond(status: number, body: unknown) {
  return vi.fn(() =>
    Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status })),
  );
}

afterEach(() => {
  document.cookie = 'shr_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

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

describe('apiFetch', () => {
  it('sends the CSRF cookie value as a header on state-changing requests only', async () => {
    document.cookie = 'shr_csrf=token-123';
    const fetchImpl = respond(200, { ok: true });
    await apiFetch('/v1/auth/logout', { method: 'POST', fetchImpl });
    await apiFetch('/v1/auth/session', { fetchImpl });

    const [, post] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const [, get] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(post.headers).toMatchObject({ 'x-csrf-token': 'token-123' });
    expect(post.credentials).toBe('include');
    expect(get.headers).not.toHaveProperty('x-csrf-token');
  });

  it('turns problem details into ApiError with field errors', async () => {
    const fetchImpl = respond(400, {
      code: 'WEAK_PASSWORD',
      detail: 'Choose a stronger password',
      errors: [{ path: 'newPassword', message: 'This password is too common' }],
    });
    const error = await apiFetch('/x', { method: 'POST', body: {}, fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'WEAK_PASSWORD', detail: 'Choose a stronger password' });
    expect((error as ApiError).fieldErrors).toHaveLength(1);
  });

  it('knows which errors mean the user must sign in again', async () => {
    const expired = await apiFetch('/x', {
      fetchImpl: respond(401, { code: 'SESSION_EXPIRED', detail: 'x' }),
    }).catch((e: unknown) => e);
    const forbidden = await apiFetch('/x', {
      fetchImpl: respond(403, { code: 'FORBIDDEN', detail: 'x' }),
    }).catch((e: unknown) => e);
    expect((expired as ApiError).needsSignIn).toBe(true);
    expect((forbidden as ApiError).needsSignIn).toBe(false);
  });

  it('returns undefined for 204 responses', async () => {
    await expect(
      apiFetch('/x', { method: 'POST', fetchImpl: respond(204, undefined) }),
    ).resolves.toBeUndefined();
  });
});

describe('safeNextPath', () => {
  it('allows only same-site relative paths', () => {
    expect(safeNextPath('/account/security')).toBe('/account/security');
    expect(safeNextPath('https://evil.example')).toBe('/');
    expect(safeNextPath('//evil.example')).toBe('/');
    expect(safeNextPath('/\\evil.example')).toBe('/');
    expect(safeNextPath(null)).toBe('/');
  });
});
