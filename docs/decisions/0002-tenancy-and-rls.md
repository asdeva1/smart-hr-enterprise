# 0002 — Shared-schema tenancy with row-level security

- Status: accepted
- Date: 2026-10-13

## Decision

Multi-tenant SaaS keeps all tenants in one PostgreSQL schema. Every tenant-owned row carries `tenant_id`. Isolation is enforced twice:

1. **Application** — the tenant id comes only from the authenticated session and is applied through `withTenant()`.
2. **Database** — row-level security policies compare `tenant_id` with `app.tenant_id`, set per transaction with `set_config(..., true)`. With no tenant set, policies match nothing.

The API and worker connect as `app_rw`, which owns no tables and cannot bypass RLS. Migrations run as `app_migrator`, the owner.

Dedicated and in-house deployments use the identical schema with one tenant.

## Why

- Schema-per-tenant or database-per-tenant multiplies migrations and connection pools; shared schema scales to thousands of small tenants.
- RLS turns a forgotten `WHERE tenant_id = …` from a data breach into an empty result.
- Transaction-local settings cannot leak between requests on pooled connections.

## Verified by

`packages/database/test/rls.int.test.ts`, run in CI against real Postgres: fail-closed reads, cross-tenant write rejection, no leakage across pooled connections, 30 concurrent mixed-tenant transactions, and a check that every table with `tenant_id` has RLS enabled. With RLS switched off, 7 of the 8 tests fail.

## Open

Platform-operator access across tenants (Phase 6) will use a separate role and audited code path; it is not designed yet.
