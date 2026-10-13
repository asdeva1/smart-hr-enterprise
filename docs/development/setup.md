# Local development setup

## 1. Tools

- Node.js 22 LTS (`nvm use` reads `.nvmrc`)
- pnpm 10 (`corepack enable` picks the version pinned in `package.json`)
- Docker with Compose

## 2. Services

```bash
cp .env.example .env
docker compose up -d
```

On first start the Postgres container runs `docker/postgres-init/01-bootstrap.sh`, which creates:

| Database          | Purpose                                         |
| ----------------- | ----------------------------------------------- |
| `smart_hr`        | Application data                                |
| `smart_hr_shadow` | Scratch database Prisma uses to diff migrations |

and two roles (see `packages/database/sql/bootstrap-roles.sql`):

| Role           | Used by         | Can do                                              |
| -------------- | --------------- | --------------------------------------------------- |
| `app_migrator` | migrations only | owns the schema                                     |
| `app_rw`       | api, worker     | read/write data, always bound by row-level security |

To start over, `docker compose down -v` deletes the local volumes. This only ever affects your local containers.

## 3. Install, migrate, run

```bash
pnpm install
# Put an MFA encryption key into .env (MFA_ENCRYPTION_KEYS) — the API refuses to start without one:
echo "MFA_ENCRYPTION_KEYS=local:$(openssl rand -base64 32)" >> .env
pnpm db:migrate:deploy
pnpm build
```

Create your organisation and first administrator. There is no public sign-up; this command runs as the schema owner and never prints the password:

```bash
BOOTSTRAP_TENANT_SLUG=demo BOOTSTRAP_TENANT_NAME="Demo Organisation" \
BOOTSTRAP_ADMIN_EMAIL=you@example.com BOOTSTRAP_ADMIN_NAME="Your Name" \
BOOTSTRAP_ADMIN_PASSWORD='a long passphrase of your own' \
pnpm --filter @smart-hr/api bootstrap:tenant
```

Then start everything and sign in at http://localhost:3000:

```bash
pnpm dev
```

Password-reset emails land in Mailpit at http://localhost:8025.

| App           | URL                                     |
| ------------- | --------------------------------------- |
| Web           | http://localhost:3000                   |
| API           | http://localhost:4000 (docs at `/docs`) |
| MinIO console | http://localhost:9001                   |
| Mailpit inbox | http://localhost:8025                   |

## 4. Tests

```bash
pnpm test               # unit tests, no services needed
pnpm test:integration   # real Postgres + Redis; run after db:migrate:deploy
pnpm --filter @smart-hr/web exec playwright install chromium   # once
pnpm build && pnpm test:e2e
```

The integration suite in `packages/database/test/rls.int.test.ts` proves tenant isolation against the real database. If it ever fails, treat it as a security incident, not a flaky test.

## Troubleshooting

- **`EnvValidationError` on start** — the message lists every missing or invalid variable. Compare with `.env.example`.
- **Prisma cannot download engines behind a corporate proxy** — set `PRISMA_ENGINES_MIRROR` to your internal mirror. `PRISMA_*` variables pass through Turborepo.
