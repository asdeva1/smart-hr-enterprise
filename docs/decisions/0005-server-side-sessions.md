# 0005 — Server-side sessions in HttpOnly cookies, not JWTs

- Status: accepted
- Date: 2026-10-13

## Decision

Authentication uses opaque, random session tokens:

- On sign-in the API creates a `user_session` row and sets `shr_session` — 256 random bits, base64url — as an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). Only its SHA-256 hash is stored.
- Every request looks the session up. Revocation, idle timeout (30 min), absolute lifetime (12 h), disabled accounts and suspended memberships take effect on the very next request.
- CSRF protection is a per-session **synchronizer token**: the API sets a readable `shr_csrf` cookie, the web app echoes it in `x-csrf-token`, and the guard compares it with the value stored on the session. In addition, any state-changing request carrying an `Origin` header outside `CORS_ORIGINS` is refused.
- The session token and CSRF token **rotate** whenever privilege changes: second factor completed, organisation switched, password changed. A new sign-in always creates a new session (no session fixation).

There are no access/refresh tokens, so refresh-token rotation and replay detection do not apply; the equivalent guarantees come from server-side state and rotation on privilege change.

## Why

- The brief requires immediate revocation, lockout and disabled-account checks; stateless JWTs need a deny-list to do that, which is a server-side session store with extra steps.
- Nothing token-like is readable by page scripts, so an XSS bug cannot exfiltrate the session.
- One indexed lookup per request is cheap at this scale; Redis caching can be added if profiling shows a need.

## Deployment

Web (Vercel) and API (AWS) must share a registrable domain, for example `app.example.com` and `api.example.com`, with `AUTH_COOKIE_DOMAIN=.example.com`. Requests between sibling subdomains are same-site, so `SameSite=Lax` cookies flow and the web app can read the CSRF cookie. Vercel preview URLs on `*.vercel.app` are a different site: previews use a preview API on a matching domain, or are used for UI review without sign-in.

## Consequences

- API calls from other services (integrations, Phase 22) will use separately issued API keys, not user sessions.
- SSO (OIDC/SAML) plugs in before session creation: an identity provider's assertion replaces the password check, then the same session machinery applies.
