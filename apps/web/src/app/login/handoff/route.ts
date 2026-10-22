import { NextResponse, type NextRequest } from 'next/server';

/**
 * Sign-in from the marketing site's header box. The site posts the form here (a normal top-level navigation, so
 * the session cookie is set on this app's own address), we sign in against the API, and send the person on:
 * to the code step, to the organisation picker, or into the app. A wrong password or a rate limit comes back
 * to the sign-in page with a message. The password travels in the POST body only, never in an address.
 */
const API = () => process.env.API_PROXY_TARGET?.replace(/\/+$/, '');

function allowedOrigins(own: string): Set<string> {
  const extra = (process.env.SITE_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return new Set([own, ...extra]);
}

export async function POST(req: NextRequest) {
  const own = req.nextUrl.origin;
  const origin = req.headers.get('origin');
  // Only this app and the marketing site may post here; anything else could be a forged sign-in.
  if (!origin || !allowedOrigins(own).has(origin)) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  }
  const back = (reason: string) => NextResponse.redirect(new URL(`/login?reason=${reason}`, own), 303);

  const form = await req.formData().catch(() => null);
  const email = form?.get('email');
  const password = form?.get('password');
  const api = API();
  if (!api || typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return back('handoff-failed');
  }

  let res: Response;
  try {
    res = await fetch(`${api}/v1/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: own,
        'user-agent': req.headers.get('user-agent') ?? 'smarthrms-web',
        'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '',
      },
      body: JSON.stringify({ email: email.slice(0, 254), password: password.slice(0, 256) }),
      redirect: 'manual',
    });
  } catch {
    return back('handoff-error');
  }
  if (res.status === 429) return back('handoff-limit');
  if (!res.ok) return back('handoff-failed');

  const view = (await res.json().catch(() => null)) as {
    mfaPending?: boolean;
    activeTenant?: unknown;
    memberships?: unknown[];
  } | null;
  const target = view?.mfaPending
    ? '/login'
    : !view?.activeTenant && (view?.memberships?.length ?? 0) > 1
      ? '/select-organisation?next=%2F'
      : '/';
  const out = NextResponse.redirect(new URL(target, own), 303);
  for (const cookie of res.headers.getSetCookie()) out.headers.append('set-cookie', cookie);
  return out;
}
