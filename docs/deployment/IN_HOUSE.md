# In-house installation

Smart HR runs on the customer's own server with the same images as SaaS. This guide covers a single-server
installation with Docker Compose. Everything stays on the server: there is no call home, and licences are
checked locally ([ADR 0009](../decisions/0009-in-house-licensing.md)).

## What you need

- A Linux server with Docker Engine and the Compose plugin; 4 vCPU, 16 GB RAM and 200 GB disk is a sensible
  start for up to 2,000 employees.
- A TLS-terminating reverse proxy or load balancer in front of the web app and the API.
- An SMTP relay for email.
- From Smartclues: the images (`api`, `worker`, `web`, `migrate`) for your version, the licence
  verification public key, and, once you send your installation id, a licence.

## Install

All commands run in `deploy/inhouse/`.

1. Load or pull the images and set `SMART_HR_VERSION` and `IMAGE_REGISTRY` in `.env`.
2. `cp .env.example .env`, replace every `CHANGE_ME`, then `chmod 600 .env`.
3. Create the database roles (once): `docker compose --profile setup run --rm db-init`
4. Apply migrations: `docker compose --profile setup run --rm migrate`
5. Start: `docker compose up -d`. Check `docker compose ps` until `api` is healthy.
6. Create the first organisation and operator (runs inside the API image; the password is read from the
   environment and never printed):

   ```sh
   set -a; . ./.env; set +a          # loads the database password into this shell only
   read -rs BOOTSTRAP_ADMIN_PASSWORD; export BOOTSTRAP_ADMIN_PASSWORD
   docker compose run --rm \
     -e DATABASE_MIGRATOR_URL="postgresql://app_migrator:${MIGRATOR_DB_PASSWORD}@postgres:5432/smart_hr" \
     -e BOOTSTRAP_TENANT_SLUG=acme -e BOOTSTRAP_TENANT_NAME="Acme Hospitals" \
     -e BOOTSTRAP_ADMIN_EMAIL=it-admin@acme.example -e BOOTSTRAP_ADMIN_NAME="IT Admin" \
     -e BOOTSTRAP_ADMIN_PASSWORD -e BOOTSTRAP_PLATFORM_ADMIN=true \
     api node dist/cli/bootstrap.js
   ```

7. Sign in, open **Platform → Licence**, send the installation id shown there to Smartclues, and paste the
   licence you receive. Until then organisation administration works and paid modules are off.

## Upgrade

1. Back up (below).
2. Set the new `SMART_HR_VERSION`.
3. `docker compose --profile setup run --rm migrate`
4. `docker compose up -d`

Migrations only move forward. To go back a version, restore the backup taken in step 1.

## Back up

`./backup.sh /secure/backups` writes a compressed `pg_dump` (custom format). Schedule it daily, copy the
files off the server, and keep them encrypted: they contain personal data. Back up `.env` separately and
securely — `MFA_ENCRYPTION_KEYS` is needed to read two-step verification secrets after a restore.

## Restoring

`./restore.sh <file>` restores into an **empty** installation only (a new server, or a test copy) and
refuses to run against a database that already holds Smart HR data. After it finishes, run the migrate
step. Replacing a live installation's data is a deliberate, manual decision: stop the stack, move the old
volume aside (do not delete it until the restore is verified), start Postgres on a fresh volume, then
restore.

## Licence lifecycle

| State                                     | What happens                                                        |
| ----------------------------------------- | ------------------------------------------------------------------- |
| Valid                                     | Licensed modules work; the Licence page warns 30 days before expiry |
| Grace (after expiry)                      | Everything still works; everyone sees a banner                      |
| Expired, unverifiable, other installation | Paid modules are read-only; data stays readable and exportable      |

Organisation administration, people and access, settings, approvals and the audit log never depend on
the licence.

## Network

The stack needs no outbound internet. Inbound, publish only the web app and the API through your proxy.
Postgres and Redis are reachable only inside the Compose network. AI features stay off unless an AI
provider is configured (Phase 20).
