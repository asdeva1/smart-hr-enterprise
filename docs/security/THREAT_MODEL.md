# Threat model

Living document; each phase adds the threats its features introduce. Last updated: Phase 2.

Method: STRIDE per asset, with the control in place, its evidence, and what remains open.

## Assets

| Asset                                                     | Why it matters                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Tenant business data (HR, payroll, finance)               | Confidential; cross-tenant exposure is the worst outcome for a SaaS HR product |
| Personal identifiers (PAN, Aadhaar, bank details, salary) | Regulated personal data (Digital Personal Data Protection Act, 2023)           |
| User credentials and sessions                             | Grant access to everything above                                               |
| MFA secrets and recovery codes                            | Bypass the second factor if stolen                                             |
| Audit trail                                               | Evidence for investigations; must not be altered                               |
| Financial postings and payroll results (later phases)     | Fraud target; must be tamper-evident                                           |

## Identity and sessions (Phase 2)

| Threat                                  | STRIDE | Control                                                                                                                                                       | Evidence                                                    |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Password guessing / credential stuffing | S      | Rate limits per IP and per email, lockout after 5 failures, argon2id                                                                                          | `auth.int.test.ts`: lockout, rate limit                     |
| Account enumeration                     | I      | Identical response and dummy hash for unknown accounts; reset endpoint always 202                                                                             | `auth.int.test.ts`: same answer tests                       |
| Session theft via XSS                   | I      | HttpOnly session cookie, so scripts cannot read it; React escapes output by default. The web app does not yet send a Content-Security-Policy (see open risks) | Playwright cookie check                                     |
| CSRF                                    | T      | Per-session synchronizer token + Origin allowlist                                                                                                             | `auth.int.test.ts`: CSRF tests                              |
| Session fixation                        | S      | New session on every sign-in; rotation on MFA, tenant switch and password change                                                                              | `auth.int.test.ts`: fixation, rotation                      |
| Stale sessions after compromise         | E      | Idle + absolute expiry, sign-out everywhere, revocation on password change, reset, lock and MFA changes                                                       | `auth.int.test.ts`: expiry, revoke tests                    |
| Reset-link interception or reuse        | S      | 30-minute, single-use, hashed, atomically claimed; newer link voids older                                                                                     | `auth.int.test.ts`: reset tests                             |
| TOTP replay                             | S      | Last-used step stored, conditional update                                                                                                                     | `auth.int.test.ts`: replay test                             |
| MFA secret theft from a database dump   | I      | AES-256-GCM with per-user associated data; keys outside the database                                                                                          | `auth.test.ts`: SecretBox tests                             |
| Open redirect via `next=`               | S      | Only same-site relative paths allowed                                                                                                                         | `api.test.ts`: `safeNextPath`                               |
| Secrets in logs or audit                | I      | Log redaction paths; audit metadata sanitiser                                                                                                                 | `observability` and `audit.service` tests; audit trail test |

## Tenancy

| Threat                                              | STRIDE | Control                                                          | Evidence                                 |
| --------------------------------------------------- | ------ | ---------------------------------------------------------------- | ---------------------------------------- |
| Cross-tenant read or write through a missing filter | I, T   | Postgres RLS under a non-owner role; tenant only from session    | `rls.int.test.ts`, `tenancy.int.test.ts` |
| Forged tenant id in request                         | E      | Tenant ids in headers, query and body ignored                    | `tenancy.int.test.ts`                    |
| IDOR on record ids                                  | I      | RLS makes other tenants' rows invisible: 404, not 403            | `tenancy.int.test.ts`                    |
| Removed member keeps access                         | E      | Membership and tenant status re-checked every request            | `tenancy.int.test.ts`                    |
| Audit tampering                                     | T, R   | Runtime role has no UPDATE/DELETE; trigger blocks even the owner | `auth-rls.int.test.ts`                   |

## Open risks

| Risk                                                                                                           | Plan                                                                                                      |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `app_user`, `user_session` and the other identity tables carry no RLS (they are read before a tenant is known) | Access confined to the auth module; review in Phase 3 whether a dedicated `app_auth` role should own them |
| Redis outage blocks sign-in (the limiter fails closed)                                                         | Deliberate; monitor Redis availability (Phase 23 alarms)                                                  |
| Email is the reset channel                                                                                     | Phase 3 adds tenant MFA enforcement; reset does not bypass MFA at next sign-in                            |
| Platform-operator cross-tenant access path not yet designed                                                    | Phase 6: separate role, audited, time-boxed                                                               |
| Repository is public                                                                                           | Owner decision; make private before customer-specific code lands                                          |
| No Content-Security-Policy on the web app (XSS could still act as the user, though not steal the session)      | Nonce-based CSP via the Next.js proxy, tested in Playwright                                               |
