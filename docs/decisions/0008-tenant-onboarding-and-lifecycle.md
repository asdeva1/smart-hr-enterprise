# 0008 — Tenant onboarding and lifecycle

- Status: accepted
- Date: 2026-10-14

## Decision

Organisations are created in exactly two ways, both through one `TenantProvisioner`:

1. **Platform console.** A platform operator provisions an organisation with an owner and, optionally, a plan.
   An owner without a password is emailed a single-use invitation; an existing account is simply added.
2. **Self-service sign-up** (off unless `SIGNUP_ENABLED=true`). Nothing is created until the emailed link is
   opened. Then the account, the organisation, its owner membership and a trial of `SIGNUP_PLAN` are created in
   one transaction. The request endpoint answers the same way for every address, so it cannot be used to find
   out who has an account; an address that already has an account only receives a "sign in instead" email.

An organisation moves through `ACTIVE → OFFBOARDING → ARCHIVED`, and can be `SUSPENDED` from `ACTIVE` or
`OFFBOARDING`. Only operators change status:

| Status      | Members can sign in | Members can change data       | Notes                                      |
| ----------- | ------------------- | ----------------------------- | ------------------------------------------ |
| ACTIVE      | Yes                 | Yes (by permission)           |                                            |
| OFFBOARDING | Yes                 | No (403 `TENANT_OFFBOARDING`) | Owners can still export everything         |
| SUSPENDED   | No                  | No                            | Sessions move off the organisation         |
| ARCHIVED    | No                  | No                            | Needs the slug typed out; data is retained |

Nothing in the lifecycle deletes data. Permanent deletion, if ever needed, is a separate, manual, audited
procedure outside the application.

Owners can export all of their organisation's data at any time (`GET /v1/tenant/export`, recent sign-in
required). Secrets — password hashes, MFA secrets, recovery codes, session and token hashes — are never
exported. Modules add their own sections to the export as they ship.

Organisations may set a display name, a main colour and an https logo URL. The colour must keep a 4.5:1
contrast ratio with white text, so branding cannot make the interface inaccessible.

## Enforcement

- API: platform routes require a platform administrator; lifecycle changes, operator grants and exports are
  audited in the affected organisation's log. The guard refuses unsafe methods while an organisation is
  offboarding.
- Database: organisations are inserted only in a platform-actor transaction (`tenant_platform_insert`).
  A trigger (`tenant_guard`) refuses changes to name, slug, status and lifecycle dates by the runtime role
  outside a platform-actor transaction, whatever the code path. Sign-up requests have row-level security and
  are visible only to platform-actor transactions.
- Operators cannot revoke their own access or remove the last operator.

## Consequences

- Each new module must register its tables with `TenantExportService` and respect the offboarding guard (it
  does automatically for every unsafe HTTP method).
- Logo URLs are loaded from the organisation's own host with `referrerPolicy="no-referrer"`. Uploaded logos
  move to object storage with the documents module (Phase 12).
