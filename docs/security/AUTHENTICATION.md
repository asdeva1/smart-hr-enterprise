# Authentication and session security

Status: implemented in Phase 2. Design decision: [ADR 0005](../decisions/0005-server-side-sessions.md).

## Identity model

| Entity        | Table                  | Notes                                                                                                       |
| ------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| User          | `app_user`             | Global login identity: email, argon2id password hash, status, lockout counters, MFA state. Not an employee. |
| Membership    | `tenant_membership`    | Grants a user access to one organisation. Row-level security: visible inside its tenant or to the member.   |
| Session       | `user_session`         | Server-side session; only the token's SHA-256 hash is stored.                                               |
| Reset token   | `password_reset_token` | Single-use, 30-minute, hash only.                                                                           |
| Recovery code | `mfa_recovery_code`    | Single-use, hash only.                                                                                      |
| Audit event   | `audit_event`          | Append-only; `UPDATE`/`DELETE` revoked and blocked by trigger.                                              |

A user is linked to an employee record in Phase 8; the two are never the same row.

## Flows

### Sign-in

1. Rate limits: 30 attempts per IP per minute, 10 per email per 15 minutes (configurable).
2. Unknown email, wrong password, locked account and disabled account all return the same `401 INVALID_CREDENTIALS` with the same message. For an unknown email, a dummy argon2 verification runs so timing does not reveal whether the account exists.
3. 5 consecutive failures lock the account for 15 minutes and revoke its sessions. Failed second-factor and re-authentication attempts count toward the same lockout.
4. Success creates a new session (a session already on that browser is revoked). With MFA enabled the session is **pending**: it lasts 5 minutes and can only call `/v1/auth/mfa/verify`, `/v1/auth/session` and `/v1/auth/logout`.
5. With exactly one membership, that organisation becomes active; with several, the user chooses.

### Second factor

- TOTP (RFC 6238, SHA-1, 6 digits, 30 s, ±1 step). Verified against the RFC test vectors in `packages/auth`.
- Replay protection: the last accepted time step is stored; a code from that step or earlier is rejected. The update is conditional, so two concurrent requests with one code cannot both succeed.
- 10 recovery codes (about 49 bits each), shown once, stored as hashes, each usable once.
- The TOTP secret is encrypted with AES-256-GCM, bound to the user id as associated data; keys are versioned for rotation (`MFA_ENCRYPTION_KEYS`).
- Enrolling, disabling and regenerating codes require **recent authentication**: password (plus code, if MFA is on) within the last 10 minutes.

### Password reset

- `POST /v1/auth/password/forgot` always answers `202` with the same message. Only active accounts receive an email; requesting a new link invalidates older ones.
- The link carries a 256-bit token; only its hash is stored. It expires after 30 minutes and is claimed atomically, so it works once even under concurrent use.
- A weak new password is rejected without spending the link.
- A successful reset clears the lockout and revokes every session.

### Change password

Requires the current password. Signs out every other session and rotates the current one.

### Sessions

- Idle timeout 30 minutes (sliding, written at most once a minute); absolute lifetime 12 hours.
- Users can list their sessions, sign out one device, or sign out everywhere.
- Disabling a user, suspending a membership or suspending a tenant takes effect on the next request.

## Request protection (global guard)

Every route requires a session unless marked `@Public()`. For each request the guard:

1. Refuses a state-changing request whose `Origin` is not in `CORS_ORIGINS`.
2. Resolves the session cookie.
3. Blocks pending-MFA sessions from everything except the second-factor endpoints.
4. Requires `x-csrf-token` to match the session's token on `POST`, `PUT`, `PATCH` and `DELETE`.
5. Applies `@RequireRecentAuth`, `@RequirePlatformAdmin`, `@RequireTenant` and `@RequireTenantAdmin`. Tenant checks re-read the membership and tenant status on every request.

The active tenant only ever comes from the session. Tenant ids in headers, query strings or bodies are ignored; tests prove this.

## Audit events

Recorded: sign-in success and failure (with reason), lockout, sign-out, sign-out everywhere, single-session revocation, password reset requested and completed, password change, re-authentication, MFA enrolment started, enabled, disabled and recovery codes regenerated, organisation switch (including denied attempts), and organisation setting changes.

Never recorded: passwords, reset tokens, session or CSRF tokens, TOTP secrets or codes, recovery codes, or authorization headers. Metadata keys matching credential patterns are stripped before writing; for unknown emails only a truncated keyed hash is stored.

## Configuration

| Variable                                          | Default                          | Purpose                                    |
| ------------------------------------------------- | -------------------------------- | ------------------------------------------ |
| `AUTH_SESSION_IDLE_MINUTES`                       | 30                               | Idle timeout                               |
| `AUTH_SESSION_ABSOLUTE_HOURS`                     | 12                               | Hard session lifetime                      |
| `AUTH_REAUTH_MINUTES`                             | 10                               | Window for sensitive changes               |
| `AUTH_LOCKOUT_THRESHOLD` / `AUTH_LOCKOUT_MINUTES` | 5 / 15                           | Lockout policy                             |
| `AUTH_RATE_LIMIT_*`                               | see `apps/api/src/config/env.ts` | Rate limits                                |
| `AUTH_COOKIE_DOMAIN`                              | unset                            | e.g. `.example.com` in production          |
| `AUTH_COOKIE_SECURE`                              | true in production               | Cannot be false in production              |
| `PASSWORD_RESET_TTL_MINUTES`                      | 30                               | Reset link lifetime                        |
| `MFA_ENCRYPTION_KEYS` / `MFA_ENCRYPTION_KEY_ID`   | required                         | `id:base64key` list and the current key id |

## Done in Phase 3

- Administrators suspend and restore members, resend invitations and send password reset links (`access.manage`), all audited. Suspension takes effect on the member's next request.
- Invitations: a new person gets an account with no password and a single-use, hashed **invitation** token (72 hours, `INVITATION_TTL_HOURS`) to set one. Someone who already has an account is simply added.
- Organisations can **require two-step verification**; see [AUTHORIZATION.md](AUTHORIZATION.md).

## Not yet implemented

| Item                                      | Status              | Acceptance criteria to close it                                                                                                                        |
| ----------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SSO (OIDC, SAML)                          | Designed, not built | Real IdP integration tests (e.g. Keycloak in CI) for login, logout, JIT provisioning and attribute mapping; per-tenant enforcement of SSO-only sign-in |
| WebAuthn / passkeys                       | Deferred            | Enrolment and sign-in tests with a virtual authenticator in Playwright                                                                                 |
| Breached-password check (k-anonymity API) | Deferred            | Opt-in per deployment; in-house installs may have no internet                                                                                          |
| Email change with verification            | Phase 21            | Confirmation to old and new address                                                                                                                    |
