# Smart HR Enterprise

HR, payroll, finance and configurable operations in one platform — delivered as multi-tenant SaaS, a dedicated managed environment, or an in-house installation, from one codebase.

**Status: Phase 1 (foundation).** The repository contains the monorepo, API, worker, web shell, database with tenant isolation, and CI. Business modules arrive phase by phase; see [the phase plan](docs/product/phases.md).

## What's here

| Path                                                  | What it is                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `apps/api`                                            | NestJS 12 REST API. Health checks, problem-details errors, OpenAPI at `/docs` outside production |
| `apps/worker`                                         | NestJS + BullMQ background worker. Heartbeat job and container health check                      |
| `apps/web`                                            | Next.js 16 App Router, Tailwind 4, shadcn/ui-style components, TanStack Query                    |
| `packages/database`                                   | Prisma 7 schema, reviewed SQL migrations, row-level security, `withTenant()` helper              |
| `packages/config`                                     | Typed environment loading with Zod; fails fast and never prints secret values                    |
| `packages/observability`                              | Structured pino logging with credential and PII redaction                                        |
| `packages/shared`                                     | Error types and UUIDv7 ids                                                                       |
| `packages/{auth,types,validation,ui,entitlements,ai}` | Placeholders; each README says which phase fills it                                              |
| `docs/`                                               | Decisions (ADRs), development, deployment and security notes                                     |
| `infra/aws`                                           | Infrastructure as code — empty until Phase 22; nothing is provisioned                            |

## Quick start

Requirements: Node 22 (see `.nvmrc`), pnpm 10, Docker.

```bash
cp .env.example .env
docker compose up -d            # Postgres 16, Redis 7, MinIO, Mailpit
pnpm install
pnpm db:migrate:deploy          # apply migrations as the app_migrator role
pnpm dev                        # api :4000, web :3000, worker
```

Open http://localhost:3000 — the System status card should show the API, database and Redis as up. API docs: http://localhost:4000/docs.

Full instructions: [docs/development/setup.md](docs/development/setup.md).

## Everyday commands

```bash
pnpm lint | pnpm typecheck | pnpm test | pnpm build
pnpm test:integration     # needs the docker compose services and migrated DB
pnpm test:e2e             # Playwright; needs a built web app and a running API
pnpm db:check             # migration guard (also runs in CI)
```

## Rules that keep this safe

- The tenant comes from the authenticated session, never from the request. Postgres row-level security enforces it underneath ([ADR 0002](docs/decisions/0002-tenancy-and-rls.md)).
- Entitlements are enforced by the API; hiding a menu is not access control.
- Migrations are written or generated, reviewed as SQL, and applied with `prisma migrate deploy`. `db push` and `migrate reset` are blocked by CI ([database guide](docs/development/database.md)).
- No secrets in the repository. CI runs a secret scan on every push.
- AI is optional and server-side only (Phase 19).
