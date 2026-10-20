import { NextResponse, type NextRequest } from 'next/server';

/**
 * Optimistic redirect only: if there is no session cookie at all, send the browser to sign-in before
 * rendering a protected page. It never decides access — the API validates the session on every request.
 * When web and API run on different sites the cookie isn't visible here; pages then fall back to the
 * client-side check in <RequireSession>.
 */
const PUBLIC_PATHS = ['/login', '/forgot-password', '/reset-password', '/signup', '/unauthorized'];

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (request.cookies.has('shr_session')) return NextResponse.next();
  if (process.env.NEXT_PUBLIC_SESSION_COOKIE_VISIBLE === 'false') return NextResponse.next();

  const login = new URL('/login', request.url);
  login.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Skip Next internals, API calls forwarded to the API (/v1, see next.config.ts) and static files.
  matcher: ['/((?!_next/|v1/|health/|iclock/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|woff2?)$).*)'],
};
