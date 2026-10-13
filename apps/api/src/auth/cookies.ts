import type { CookieOptions, Response } from 'express';
import type { ApiEnv } from '../config/env.js';
import { CSRF_COOKIE, SESSION_COOKIE } from './auth.types.js';
import type { IssuedSession } from './session.service.js';

function baseOptions(env: ApiEnv): CookieOptions {
  return {
    path: '/',
    sameSite: 'lax',
    secure: env.AUTH_COOKIE_SECURE,
    ...(env.AUTH_COOKIE_DOMAIN ? { domain: env.AUTH_COOKIE_DOMAIN } : {}),
  };
}

/**
 * Session cookie: HttpOnly, so page scripts can never read it.
 * CSRF cookie: readable by the web app, which echoes it in the x-csrf-token header.
 * Both expire at the session's absolute limit; the server enforces the idle timeout itself.
 */
export function setSessionCookies(res: Response, issued: IssuedSession, env: ApiEnv): void {
  const expires = issued.session.absoluteExpiresAt;
  res.cookie(SESSION_COOKIE, issued.token, { ...baseOptions(env), httpOnly: true, expires });
  res.cookie(CSRF_COOKIE, issued.session.csrfToken, { ...baseOptions(env), httpOnly: false, expires });
}

export function clearSessionCookies(res: Response, env: ApiEnv): void {
  res.clearCookie(SESSION_COOKIE, { ...baseOptions(env), httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { ...baseOptions(env), httpOnly: false });
}
