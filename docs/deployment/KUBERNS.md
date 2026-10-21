# Deploying on Kuberns

Kuberns builds each service from this repository's `main` branch. It runs three services from one
monorepo:

| Service | Folder        | Port | Notes                                                                                                                |
| ------- | ------------- | ---- | -------------------------------------------------------------------------------------------------------------------- |
| Web     | `apps/web`    | 3000 | Next.js standalone                                                                                                   |
| API     | `apps/api`    | 4000 | Runs `bootstrap-db-roles.mjs`, then `prisma migrate deploy`, then starts                                             |
| Worker  | `apps/worker` | —    | Background jobs (emails, approval escalation, sweeps). Add it as a background worker on the API's database and Redis |

## Database roles (required)

Tenant isolation relies on PostgreSQL row-level security. The table owner and superusers are not bound by
it, so **the API and worker refuse to start if `DATABASE_URL` is the database's owner user**. A managed
database comes with one owner user, so:

1. Keep the owner user's URL as `DATABASE_MIGRATOR_URL` (migrations and the sync commands use it).
2. Set `APP_DB_PASSWORD` to a new random password (at least 16 characters). On start, the API's
   `bootstrap-db-roles.mjs` gives the restricted role `app_rw` that password.
3. Set `DATABASE_URL` to the same host, port and database, but with user `app_rw` and that password:
   `postgresql://app_rw:<APP_DB_PASSWORD>@<host>:<port>/<database>`.

Use the same `DATABASE_URL` for the worker.

## Environment variables

API (in addition to the database variables above):

| Variable                                         | Value                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `REDIS_URL`                                      | The environment's Redis                                              |
| `APP_PUBLIC_URL`, `CORS_ORIGINS`                 | The web service's public URL                                         |
| `MFA_ENCRYPTION_KEYS`, `MFA_ENCRYPTION_KEY_ID`   | `mfa-1:<32 random bytes, base64>` and `mfa-1`                        |
| `DATA_ENCRYPTION_KEYS`, `DATA_ENCRYPTION_KEY_ID` | `data-1:<32 different random bytes, base64>` and `data-1`            |
| `STORAGE_LOCAL_DIR`                              | A persistent volume path, or uploaded documents are lost on redeploy |

Generate each key on your own computer and paste it into Kuberns' secret settings — don't share it in chat:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Keep a copy of both key rings somewhere safe.** Without them, MFA secrets and encrypted personal data
(identity numbers, bank details, documents) can't be read again.

Web: `NEXT_PUBLIC_API_URL` = the API's public URL (it is built into the page, so changing it needs a rebuild).

Worker: `DATABASE_URL` (app_rw), `REDIS_URL`, `APP_PUBLIC_URL`, and `SMTP_URL` / `MAIL_FROM` to send email.

## First-run setup (no console needed)

Kuberns has no shell, so the API can do its own one-time setup on start. Set these on the API service:

| Variable                                        | Value                                                       |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `STARTUP_TASKS`                                 | `true`                                                      |
| `BOOTSTRAP_TENANT_NAME`                         | Your organisation's name (`BOOTSTRAP_TENANT_SLUG` optional) |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME` | Your sign-in email and name                                 |
| `BOOTSTRAP_ADMIN_PASSWORD`                      | A strong password you choose (never shared in chat)         |

On start, with `STARTUP_TASKS=true`, the API syncs the plan catalogue and system roles for every
organisation. If the database has **no organisations yet** and all four `BOOTSTRAP_*` values are set, it
also creates the organisation and its owner. Problems are logged as `[startup] …` and never stop the API.
The password is never logged. After you have signed in, **delete the `BOOTSTRAP_*` variables**.

The same steps can be run by hand where a console exists (they use `DATABASE_MIGRATOR_URL` and are idempotent):

```sh
node dist/cli/sync-plan-catalogue.js
node dist/cli/sync-system-roles.js
BOOTSTRAP_TENANT_NAME="Acme" BOOTSTRAP_ADMIN_EMAIL=you@acme.example \
BOOTSTRAP_ADMIN_NAME="Your Name" BOOTSTRAP_ADMIN_PASSWORD='…' node dist/cli/bootstrap.js
```

## Pushing to `main` deploys

Kuberns deploys every push to `main`. Use a branch for work that shouldn't go live yet.

## Hosts without a worker (Vercel)

When no always-on worker runs, the five sweeps (email outbox, approval escalation, subscription expiry,
document reminders, webhook delivery) are triggered over HTTP instead: `GET /api/cron` on the API, with
`Authorization: Bearer $CRON_SECRET`. `?jobs=outbox,documents` limits the run. `apps/api/vercel.json` schedules
one daily run through Vercel Cron (the free plan's limit), and `.github/workflows/sweeps.yml` calls it every five
minutes; give that workflow the repository secret `CRON_SECRET`.
