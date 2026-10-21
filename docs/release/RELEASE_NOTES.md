# Smart HR Enterprise: release candidate notes

Release candidate for the first production release. Status as of 2026-10-21; every item below was verified on the
commit named in the pull from `main`, with CI green (format, dependency audit, migrations and drift check, lint,
types, unit, integration, end-to-end, container images, secret scan).

## What is in the release

HR and people: organisation set-up, employees and org chart, onboarding, attendance, leave and holidays, payroll,
documents and e-signatures, recruitment, self-service home and team view.
Finance and operations: expenses and vendors, procurement, inventory, assets, projects and timesheets, finance
ledger and reports, a configurable operations platform.
Platform: row-level tenant isolation, roles and permissions, approvals with delegation, audit log, notifications and
email outbox, global search, API keys and signed webhooks, optional AI (opt-in per organisation, token budgets),
tenant data export, plans and entitlements, platform operator console.

## Verified

- Staging runs on Vercel (web and API), Neon PostgreSQL and Upstash Redis; health check reports database and Redis up.
- First administrator created and able to sign in; first-run settings switched off.
- Background sweeps authenticate and succeed.
- Performance at 20,000 employees: every measured endpoint under 150 ms at the 95th percentile (`docs/PERFORMANCE.md`).
- Dependency audit: no known high-severity vulnerabilities in production dependencies.

## Not yet done (blocks calling it production-ready)

| Item                                                                      | Owner          |
| ------------------------------------------------------------------------- | -------------- |
| Private S3 bucket and key (documents do not persist on Vercel without it) | You            |
| Outgoing email (Resend SMTP) so reset and notification emails send        | You            |
| MFA on for every administrator                                            | You            |
| Delete the `BOOTSTRAP_*` settings; rotate the old Kuberns credentials     | You            |
| UAT script (`UAT.md`) run and signed off                                  | You and Claude |
| Restore rehearsal from a database backup                                  | You and Claude |
| Independent penetration test before real payroll data                     | You            |
| Sweeps every 1 to 5 minutes (paid Vercel plan or external pinger)         | You            |
| AI provider key, if AI is to be used                                      | You            |

## Deferred by decision

- Medical-coder and revenue-cycle productivity: arrives later through a feed from SmartCode.
- Product screenshots for the user guide.

## Known limits

- Free Vercel plan: daily cron only, so email and webhooks lean on GitHub or an external pinger and can lag.
- The organisation chart loads the whole tree; plan to load it level by level beyond about 50,000 people.
- Cold starts on serverless can add a second or two to the first request after idle.

Go-live steps: `GO_LIVE.md`. Acceptance script: `UAT.md`.
