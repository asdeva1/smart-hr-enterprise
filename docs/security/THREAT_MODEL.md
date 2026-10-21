# Threat model

Living document; each phase adds the threats its features introduce. Last updated: Phase 24.

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

## Documents and uploads (Phase 12)

| Threat                                                | Control                                                                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| A disk, backup or storage bucket leaks documents      | Files encrypted with AES-256-GCM before they are written, bound to organisation and file id; keys held outside the database   |
| A stored file is swapped or corrupted                 | SHA-256 of the plaintext stored on insert (insert-only table) and checked on every read; a mismatch is refused                |
| Malicious upload (HTML or script renamed, executable) | Content sniffing with matching extensions; size and plan storage limits; downloads only as attachments with `nosniff` and CSP |
| Path traversal through file names or storage keys     | Keys are generated (`tenant/uuid`) and validated; user file names are cleaned and only used for the download header           |
| Someone signs a different document than the one sent  | The document's SHA-256 is fixed when sent, re-checked before each signature and printed on the certificate                    |
| A signature or refusal is rewritten afterwards        | Triggers make signatures, refusals and closed requests final; column grants protect who was asked and what was sent           |
| Signing from an unattended session                    | Signing needs a recent password entry (and the code, with two-step verification on)                                           |
| Managers or colleagues browse others' documents       | Scope-checked `documents.view/manage`; employees see only what is shared with them; 404 otherwise; downloads audited          |

## Recruitment (Phase 13)

| Threat                                              | Control                                                                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Candidates' personal data seen by people not hiring | Scope-checked `recruitment.view/manage`; interviewers see only their applications; résumés encrypted, downloads audited |
| Interviewers influencing each other                 | Blind feedback until one's own is given; submitted feedback final in the database                                       |
| An offer or hire made without sign-off              | Openings and offers go through the approval engine; terms can't be rewritten; hiring needs `employees.manage`           |

## Payroll (Phase 14)

| Threat                                            | Control                                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Pay released without sign-off, or by its preparer | Every run goes through the approval engine; requesters never approve their own; no automatic approval                    |
| Approved pay altered afterwards                   | Database triggers keep approved, paid and cancelled runs and their payslips final; salary history insert-only            |
| Salaries seen by people not running payroll       | Scope-checked `payroll.*` permissions (not in the HR administrator role); employees see only their own approved payslips |
| Bank account numbers leaked through exports       | Bank file needs `payroll.manage`, recent password entry, approved pay; audited; payslip emails carry no amounts          |
| Formula injection through exported CSVs           | Cells starting with `=`, `+`, `-`, `@` (other than numbers) are neutralised                                              |

## Finance (Phase 15)

| Threat                                                | Control                                                                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| A journal posted without sign-off, or by its preparer | Manual journals go through the approval engine; requesters never approve their own; no automatic approval       |
| Posted entries altered or deleted to hide fraud       | Database triggers keep posted and cancelled journals and their lines final; corrections only by linked reversal |
| Unbalanced books                                      | DB requires balanced, one-sided lines and a matching total to post; reports computed in integer paise           |
| Closed periods changed after the fact                 | Posting on or before the closing date refused in the database; closing and reopening audited                    |
| Books seen outside one's company                      | Scope-checked `finance.*` permissions; approvers can open only journals sent to them                            |

## Operations, projects and inventory (Phases 17, 18)

| Threat                                                  | Control                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Approved time or stock history rewritten                | Triggers keep approved time entries final for the runtime role; stock movements are an append-only ledger (grants and triggers) |
| Profitability or rates seen by people who only log time | Money fields returned only to `projects.view/manage`; everyone else sees hours                                                  |
| Work items read by people outside the workspace         | Scope-checked `operations.*`; an item is visible to its assignee, creator or a viewer in its company; 404 otherwise             |
| Two people take the same item number or stock           | Row locks and advisory locks; the database refuses negative stock                                                               |

## AI (Phase 20)

| Threat                                              | Control                                                                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Data sent to a model without the organisation's say | Off until an administrator turns it on; per-organisation monthly token budget                                                             |
| The assistant shows more than the person may see    | Tools run as the signed-in person through the same services and permission checks; read-only                                              |
| Prompt injection in item comments or documents      | Model output never performs actions; tools are read-only; content is passed as data; a test plants an injection in a comment              |
| Prompts and answers kept in logs or the database    | Usage records hold token counts only; audit holds a short hash of the question; logs carry no content                                     |
| Provider key or AWS credentials leak                | Server-side only; never in errors or responses; IAM keys alone never switch the provider on; Bedrock uses signed requests or a scoped key |

## Search (Phase 22)

| Threat                                        | Control                                                                                                          |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Search reveals records the person cannot open | Each group is read through its module's own service and scope checks; groups the role or plan lacks are left out |
| Search exposes sensitive fields               | Results carry title, code and a link only; identity numbers, pay and comments are never searched                 |
| Search used to enumerate the directory        | Two-character minimum, five results per group, authenticated only                                                |

## Integrations: webhooks and API keys (Phase 22)

| Threat                                            | STRIDE | Control                                                                                                                                                                                                     |
| ------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Webhook address aimed at internal services (SSRF) | I, E   | https only, no credentials in the address, private/loopback/link-local/metadata ranges refused when entered and again when connecting (resolved address is the one checked); no redirects; reply never read |
| Forged events sent to a receiver                  | S      | HMAC-SHA256 signature over id, timestamp and body; per-endpoint secret shown once; rotation replaces it at once                                                                                             |
| Webhook secret theft from a database dump         | I      | AES-256-GCM, bound to organisation and endpoint, key ring outside the database                                                                                                                              |
| Personal data leaving through events              | I      | Payloads carry ids and codes only; delivered payloads are cleared                                                                                                                                           |
| A failing or slow receiver ties up delivery       | D      | 10 s timeout, bounded retries with backoff, endpoint switched off after repeated failure, at most 10 active endpoints                                                                                       |
| API key theft from a database dump                | I      | Only a SHA-256 of a 256-bit random key is stored; shown once                                                                                                                                                |
| Key guessing or learning which keys exist         | S, I   | 256-bit secrets; constant-time comparison even for unknown prefixes; one identical 401 for every failure                                                                                                    |
| A key used beyond its purpose                     | E      | Named scopes (`employees.read` only); keys work only under `/v1/integrations/api`; stop when the plan loses the feature; revocable; optional expiry                                                         |
| Cross-organisation reads with a key               | I      | The key fixes the organisation; reads run under row-level security                                                                                                                                          |
| Setting up integrations by a non-administrator    | E      | `settings.manage` plus the plan feature; every change audited without secrets                                                                                                                               |

## Storage (Phase 23)

| Threat                           | Control                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A bucket leak exposes documents  | Files are encrypted before upload and bound to organisation and file id; only ciphertext is in the bucket; hash checked on every read |
| Over-powered storage credentials | Runbook asks for a key limited to `GetObject`/`PutObject` on one private bucket; credentials never appear in errors                   |
| Storage key tampering            | Keys are generated ids and validated before any request                                                                               |

## Open risks

| Risk                                                                                                           | Plan                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `app_user`, `user_session` and the other identity tables carry no RLS (they are read before a tenant is known) | Access confined to the auth module; review in Phase 3 whether a dedicated `app_auth` role should own them               |
| Redis outage blocks sign-in (the limiter fails closed)                                                         | Deliberate; monitor Redis availability (staging alarms)                                                                 |
| Email is the reset channel                                                                                     | Phase 3 adds tenant MFA enforcement; reset does not bypass MFA at next sign-in                                          |
| Platform-operator cross-tenant access path not yet designed                                                    | Phase 6: separate role, audited, time-boxed                                                                             |
| Repository is public                                                                                           | Owner decision; make private before customer-specific code lands                                                        |
| Candidate data has no retention or erasure workflow yet                                                        | Compliance work (retention rules, erasure requests) in a later phase                                                    |
| Uploaded files are not virus-scanned                                                                           | A scanner service with the AWS phase; until then only the listed types are accepted and files are never rendered inline |
| No Content-Security-Policy on the web app (XSS could still act as the user, though not steal the session)      | Nonce-based CSP via the Next.js proxy, tested in Playwright                                                             |
| Webhook delivery on serverless hosting is up to five minutes late (free scheduler)                             | Paid plan or a small always-on worker for near-real-time delivery                                                       |
| Search uses substring matching without an index                                                                | Fine for thousands of records; add trigram indexes before tens of thousands per organisation                            |
| Dependency audit is clean today (`pnpm audit --prod`)                                                          | Run in CI on a schedule and on lockfile changes                                                                         |
