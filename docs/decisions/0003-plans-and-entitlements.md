# 0003 — Plans and entitlements as versioned data

- Status: proposed (implemented in Phase 5)
- Date: 2026-10-13

## Decision

Plans (Lite, Pro, Premium, Enterprise) are rows in a versioned catalog, not code. A published plan version is immutable. Each version lists feature keys (`payroll.run`), limits (`employees.max`), prices per currency and billing period, trial policy, support level and deployment eligibility.

A tenant's effective entitlements are: plan features ∪ add-ons ∪ audited overrides. In-house deployments build the same object from a signed licence file.

The API enforces entitlements with a guard (`@RequiresFeature`) and inside the service transaction for limits. The web app reads entitlements only to show or hide UI.

Expiry never deletes data: after a grace period, gated modules become read-only; reads, exports and administration stay available.

## Why

- Prices and packaging change often; code releases should not be needed to change them.
- Versioning lets existing customers keep their terms until renewal.
- One entitlement object serves SaaS, dedicated and in-house deployments.
