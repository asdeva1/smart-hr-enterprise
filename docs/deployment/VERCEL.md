# Deploying on Vercel (staging and production)

Two Vercel projects from this repository, a managed Postgres and a managed Redis. There is no always-on worker:
background work runs through the cron endpoint (see [Background work](#background-work)).

| Part     | Service                       | Notes                                                                                           |
| -------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| Web      | Vercel project, `apps/web`    | Next.js. `NEXT_PUBLIC_API_URL` is built into the pages, so changing it needs a redeploy.        |
| API      | Vercel project, `apps/api`    | Build runs `vercel-prepare.mjs`: creates the restricted `app_rw` role, then applies migrations. |
| Database | Neon Postgres (Vercel add-on) | The owner URL is only for migrations and first-run tasks; the app connects as `app_rw`.         |
| Redis    | Upstash (Vercel add-on)       | Rate limits and queues.                                                                         |

## Settings per project (names only; never put values in chat or in the repository)

**API**

| Variable                                                                                  | Purpose                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED`                                                   | Provided by the Neon add-on. At runtime the pooled URL is used as `app_rw`.                                                                                                                                                                                                                                  |
| `APP_DB_PASSWORD`                                                                         | Password for `app_rw` (16+ random characters). Set once.                                                                                                                                                                                                                                                     |
| `REDIS_URL`                                                                               | From the Upstash add-on.                                                                                                                                                                                                                                                                                     |
| `APP_PUBLIC_URL`, `CORS_ORIGINS`                                                          | The web project's public URL.                                                                                                                                                                                                                                                                                |
| `MFA_ENCRYPTION_KEYS` / `_KEY_ID`, `DATA_ENCRYPTION_KEYS` / `_KEY_ID`                     | Two different 32-byte key rings. Keep copies safe: without them encrypted data cannot be read.                                                                                                                                                                                                               |
| `CRON_SECRET`                                                                             | Protects `/api/cron`. Same value as the GitHub secret of the same name.                                                                                                                                                                                                                                      |
| `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | **Required for documents.** A serverless disk is discarded between runs, so files must live in a bucket. `S3_ENDPOINT` only for S3-compatible services (Cloudflare R2, MinIO). Files are encrypted before upload; give the key only `GetObject` and `PutObject` on that bucket, and keep the bucket private. |
| `SMTP_URL`, `MAIL_FROM`                                                                   | Outgoing email. Without them, emails stay queued.                                                                                                                                                                                                                                                            |
| `ANTHROPIC_API_KEY` or `AWS_BEARER_TOKEN_BEDROCK` + `AWS_REGION` + `AI_MODEL`             | Optional AI. See [AI](../modules/AI.md).                                                                                                                                                                                                                                                                     |
| `STARTUP_TASKS`, `BOOTSTRAP_*`, `PLATFORM_ADMIN_FIRST_OWNER`                              | First-run only. Set `STARTUP_TASKS=false` and `PLATFORM_ADMIN_FIRST_OWNER=false` once the first administrator exists.                                                                                                                                                                                        |

**Web**: `NEXT_PUBLIC_API_URL` (the API project's public URL).

## First deployment

1. Create the Neon and Upstash add-ons and connect them to the API project.
2. Set the settings above. Generate each key ring on your own computer:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
3. Deploy the API. Check the build log shows `[prepare] runtime role ready` and the migrations applied.
4. Deploy the web project with `NEXT_PUBLIC_API_URL` set.
5. Open the web address and sign in as the bootstrap administrator. Then turn the first-run settings off and redeploy.
6. In the repository's GitHub settings add the secret `CRON_SECRET` and, for a non-default API address, the
   variable `SWEEP_BASE_URL`.

## Background work

`GET /api/cron` (header `Authorization: Bearer $CRON_SECRET`) runs the sweeps: email outbox, approval escalation,
subscription expiry, document reminders and webhook delivery. Vercel Cron calls it daily (free-plan limit) and the
GitHub workflow `sweeps.yml` calls it every five minutes. `?jobs=outbox,webhooks` limits a run. On the free
plan, email and webhooks therefore arrive up to five minutes after the event; a paid plan can schedule it every minute.

## Staging check (before calling a deployment good)

- [ ] `GET <api>/__ping` answers; sign-in works on the web address; the Platform menu shows for the platform owner.
- [ ] `GET <api>/api/cron` with the secret returns 200 and every sweep `ok`; without the secret, 401.
- [ ] Add an employee, ask for a password reset: the email arrives within five minutes.
- [ ] Create a webhook to a test receiver, press "Send test", see the delivery marked Sent.
- [ ] Documents: upload, download, and see it again after a redeploy (needs `STORAGE_DRIVER=s3`, see below).
- [ ] Sign in as a non-administrator and confirm admin screens refuse them.
- [ ] Runtime logs show no errors for ten minutes of use; no secret or personal data appears in logs.
- [ ] Take a database backup/branch and restore it into a scratch database; the app starts against it.

## Rolling back

Promote the previous deployment of the web or API project in Vercel. Migrations are forward-only: a release that
adds a migration must stay compatible with the previous code for one release (add columns and tables first, remove
them in a later release).

## Known limits on this setup

- No always-on worker, so no sub-minute scheduling.
- Serverless functions are time-limited (60 s); large imports and exports run in pieces.
