import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const OWN = 'https://app.example.test';
const SITE = 'https://site.example.test';

function post(fields: Record<string, string>, origin: string | null = SITE) {
  const body = new URLSearchParams(fields);
  return new NextRequest(`${OWN}/login/handoff`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(origin ? { origin } : {}) },
    body,
  });
}

beforeEach(() => {
  process.env.API_PROXY_TARGET = 'https://api.example.test';
  process.env.SITE_ORIGINS = SITE;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SITE_ORIGINS;
});

describe('sign-in from the marketing site', () => {
  it('refuses posts from other origins, and posts with no origin', async () => {
    expect((await POST(post({ email: 'a@b.co', password: 'x' }, 'https://evil.test'))).status).toBe(403);
    expect((await POST(post({ email: 'a@b.co', password: 'x' }, null))).status).toBe(403);
  });

  it('goes back to the sign-in page with a message on a wrong password or a limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    const wrong = await POST(post({ email: 'a@b.co', password: 'x' }));
    expect(wrong.status).toBe(303);
    expect(wrong.headers.get('location')).toBe(`${OWN}/login?reason=handoff-failed`);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })));
    expect((await POST(post({ email: 'a@b.co', password: 'x' }))).headers.get('location')).toContain(
      'handoff-limit',
    );
  });

  it('relays the session cookies and enters the app', async () => {
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append('set-cookie', 'session=abc; Path=/; HttpOnly; Secure; SameSite=Lax');
    headers.append('set-cookie', 'csrf=def; Path=/; Secure; SameSite=Lax');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ activeTenant: { id: 't' }, memberships: [{}] }), { headers }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(post({ email: 'a@b.co', password: 'secret value' }));
    expect(res.headers.get('location')).toBe(`${OWN}/`);
    expect(res.headers.getSetCookie()).toHaveLength(2);
    // The API is told which origin is signing in, and the password is sent in the body only.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('secret');
    expect((init.headers as Record<string, string>).origin).toBe(OWN);
  });

  it('sends people with a second factor to the code step, and multi-organisation people to the picker', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ mfaPending: true }))));
    expect((await POST(post({ email: 'a@b.co', password: 'x' }))).headers.get('location')).toBe(
      `${OWN}/login`,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ activeTenant: null, memberships: [{}, {}] }))),
    );
    expect((await POST(post({ email: 'a@b.co', password: 'x' }))).headers.get('location')).toContain(
      '/select-organisation',
    );
  });
});
