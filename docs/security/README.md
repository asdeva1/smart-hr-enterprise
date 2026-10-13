# Security notes

See also: [Authentication](AUTHENTICATION.md) · [Threat model](THREAT_MODEL.md)

## Controls in place (Phases 1–2)

| Area             | Control                                                                                              | Where                                |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Authentication   | argon2id, lockout, rate limits, generic errors, server-side sessions, CSRF tokens, TOTP MFA, audited | `apps/api/src/auth`, `packages/auth` |
| Tenant isolation | Session-derived tenant + Postgres RLS, tested in CI                                                  | `packages/database`                  |
| Least privilege  | Runtime DB role owns nothing, cannot create objects or bypass RLS                                    | `sql/bootstrap-roles.sql`            |
| Error handling   | Problem details; 5xx responses never include internal messages                                       | `apps/api/src/common`                |
| Logging          | Passwords, tokens, PAN, Aadhaar, bank and salary fields redacted                                     | `packages/observability`             |
| HTTP             | Helmet headers, CORS allowlist, no `X-Powered-By`                                                    | `apps/api`, `apps/web`               |
| Configuration    | Env validated at start; values never echoed in errors                                                | `packages/config`                    |
| Secrets          | `.env` ignored by Git; gitleaks in CI                                                                | `.gitignore`, CI                     |
| Supply chain     | Lockfile, pinned versions, GitHub Actions pinned to commit SHAs, pnpm install scripts allow-listed   | `pnpm-workspace.yaml`, CI            |
| Containers       | Non-root user, production dependencies only                                                          | `docker/node-app.Dockerfile`         |

## Repository visibility

The GitHub repository is currently **public**. Make it private before any customer-specific configuration, licence keys or business logic land.

## Reporting

Report suspected vulnerabilities privately to the repository owner; do not open public issues.
