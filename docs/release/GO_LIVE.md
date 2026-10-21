# Production readiness checklist

Work through in order. Items marked (you) need an account owner; the rest can be checked from the repository.

## 1. Code and tests

- [ ] CI green on the commit to release (format, audit, migrations, lint, types, unit, integration, end-to-end, images, secret scan).
- [ ] UAT (`UAT.md`) signed off with no blocking defects.
- [ ] Performance baseline (`docs/PERFORMANCE.md`) re-run against staging data volumes.

## 2. Secrets and configuration (you)

- [ ] Every secret generated fresh for production; none shared with staging. Names are in `docs/deployment/VERCEL.md` or `IN_HOUSE.md`.
- [ ] Data encryption keys and MFA keys backed up in a separate secure place; losing them makes stored secrets unreadable.
- [ ] `STARTUP_TASKS` and first-owner settings reviewed; the platform admin account created and MFA on.
- [ ] Credentials exposed during development rotated, including the old Kuberns database password.
- [ ] Storage on a private S3 bucket with a scoped key, not local disk. Public access blocked.
- [ ] Email provider configured with SPF and DKIM; a test message reaches an inbox, not spam.
- [ ] `CRON_SECRET` set on the host and in GitHub; sweeps visibly running.
- [ ] AI off by default; if enabled, provider key set and budgets agreed.

## 3. Data safety

- [ ] Automated database backups on, and one restore rehearsed into a scratch database with the result recorded.
- [ ] Point-in-time recovery window agreed (Neon history length or in-house WAL archive).
- [ ] S3 versioning on for documents.
- [ ] Tenant export tested for a pilot organisation.
- [ ] Retention and deletion rules for ex-employees agreed with HR and legal.

## 4. Security

- [ ] Threat model (`docs/security/THREAT_MODEL.md`) reviewed; open items accepted or fixed.
- [ ] Dependency audit clean at high severity.
- [ ] Row-level security confirmed on the production database role (`app_rw`, not the owner).
- [ ] Rate limits, CORS origins and public URLs set to the production domain only.
- [ ] Independent penetration test booked or done before real payroll data is loaded.

## 5. Operations

- [ ] Custom domain with HTTPS; web and API on the same site or CORS set explicitly.
- [ ] Uptime check on `/health/ready`; alerts to a named person.
- [ ] Error and log access for the on-call person; retention long enough for audits.
- [ ] Runbook for rollback (`VERCEL.md` or `IN_HOUSE.md`) rehearsed once.
- [ ] Support contact, severity levels and response times written down.

## 6. People

- [ ] Admin and manager training done; short guides for employees.
- [ ] Pilot group chosen; payroll run in parallel with the current process for at least one cycle.
- [ ] Cut-over date, freeze window and rollback decision-maker agreed.

## 7. Cut-over

- [ ] Final migration run on production; plan catalogue and system roles synced.
- [ ] Organisation created, admin invited, master data loaded, employees imported and spot-checked.
- [ ] Smoke test: sign in, view an employee, apply and approve a leave, view a payslip.
- [ ] Announce; watch errors and the sweep status for the first day.
