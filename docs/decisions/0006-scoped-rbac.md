# 0006 — Scoped roles with data-defined permissions

- Status: accepted
- Date: 2026-10-13

## Decision

Authorization is role-based with **scopes**. A role is a tenant-owned set of permission codes; a role assignment gives a member that role for the whole organisation or for one company, branch or department. The permission catalogue is code (`@smart-hr/shared`), roles and assignments are data.

Organisation owners (`tenant_membership.is_tenant_admin`) hold every permission and are the only people who can grant ownership. Everyone else gets permissions only through assignments, and can never grant more than they hold (see [AUTHORIZATION.md](../security/AUTHORIZATION.md)).

Checks happen in two steps: the guard requires the permission somewhere (`@RequirePermission`), the service requires it for the specific record's scope. Row-level security and tenant-qualified foreign keys sit underneath.

## Why

- HR and finance data is naturally split by legal entity, location and department; a regional HR manager must not see head office.
- Data-defined roles let each customer shape access without code changes; a code-defined catalogue keeps permissions reviewable and testable.
- Re-reading assignments every request (one indexed query joined with the membership check) keeps revocation immediate, matching the session design in ADR 0005.

## Consequences

- Each module adds its permission codes and decides which scope its records sit in.
- Built-in roles are re-synced after deployments by `sync-system-roles`; new permissions reach the _Organisation administrator_ role automatically.
- If request volume makes the per-request lookup measurable, cache the assignment set in Redis keyed by membership and invalidate on change. Not needed yet.
