# 0003 — Plans and entitlements as versioned data

- Status: accepted (implemented in Phase 5)
- Date: 2026-10-14

## Decision

Plans (Lite, Pro, Premium, Enterprise) are rows in a global catalogue, not code. Each plan has versions; a
version lists feature codes, limits, trial and grace days, support level, deployment models and list prices
per currency and billing period. **A published version is immutable**: a database trigger refuses any change
to its contents or prices, for every role. A change to a plan is a new version, and organisations keep the
version they are on until an operator moves them.

An organisation's entitlements are resolved on every gated request (`@smart-hr/entitlements`):

```
plan version features ∪ add-on features ∪ granted overrides − removed overrides
plan version limits    + add-on increments × quantity       → overrides set exact values
```

Subscription state comes from stored status **and dates**: a trial or period that has ended is in grace for
the plan's grace days, then expired — without waiting for any background job. The worker's expiry sweep only
makes the stored status, history and audit log catch up, and tells the owners.

| Effective status               | Gated modules                                |
| ------------------------------ | -------------------------------------------- |
| TRIAL, ACTIVE, PAST_DUE, GRACE | Full use                                     |
| EXPIRED, SUSPENDED             | **Read-only**: view and export, no changes   |
| NONE (no subscription)         | Not available; foundation modules still work |

The organisation foundation (structure, people and access, settings, approvals, audit) is never gated:
an organisation can always administer itself and reach its data. **Expiry never deletes or hides data.**

## Enforcement

- `@RequireFeature('payroll')` on a route: the global guard resolves entitlements in the tenant's own
  transaction and refuses with `ENTITLEMENT_REQUIRED` (feature missing) or `SUBSCRIPTION_READ_ONLY` (change
  attempted while expired or suspended). The check runs after permission checks.
- Limits: `EntitlementsService.assertWithinLimit(tx, key)` inside the transaction that creates the thing.
  A transaction-scoped advisory lock per organisation and limit serialises concurrent checks, so two
  requests can't both take the last place. Modules register a usage counter for the limits they own.
- The web app reads the plan from the session only to show or hide navigation and banners.

## Who can change what

The catalogue and subscriptions are written only from the platform console (`/v1/platform/*`, platform
administrators). Those code paths mark their transaction as a platform actor (`app.platform_actor`).
Row-level security on `subscription`, `subscription_addon`, `entitlement_override` and
`subscription_event` requires that flag for writes, so a tenant code path — even with its own tenant
context — cannot change what an organisation has bought. Reading across organisations (the console's list)
needs the flag **and** no tenant context; once a transaction is scoped to one organisation it sees only that
organisation, platform or not.

Every subscription change writes `subscription_event` (the billing history, append-only for the runtime
role) and the organisation's audit log in the same transaction.

## Billing

No payment-card data is stored. `subscription.provider` is `manual` (invoiced offline, renewed by an
operator); a payment-provider adapter can set `provider` and `provider_ref` later without changing
entitlements. Prices are never hard-coded: the starting catalogue has none.

## Why

- Prices and packaging change often; code releases should not be needed to change them.
- Versioning lets existing customers keep their terms until renewal.
- One entitlement object serves SaaS, dedicated and in-house deployments (Phase 7 builds it from a licence).
