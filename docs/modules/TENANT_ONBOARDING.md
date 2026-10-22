# Tenant onboarding and administration

See [ADR 0008](../decisions/0008-tenant-onboarding-and-lifecycle.md) for the rules. This page lists what is
where.

## Screens

| Screen                         | Who                  | What                                                        |
| ------------------------------ | -------------------- | ----------------------------------------------------------- |
| Platform → Organisations       | Platform operators   | List, create (owner invitation, optional plan)              |
| Platform → Organisation detail | Platform operators   | Overview, owners, rename, suspend, offboard, archive; plan  |
| Platform → Operators           | Platform operators   | Grant or revoke operator access (asks for the password)     |
| Administration → Branding      | `settings.manage`    | Display name, colour (contrast-checked), logo, live preview |
| Administration → Your data     | Organisation owners  | Full JSON export (asks for the password when not recent)    |
| `/signup`, `/signup/complete`  | Anyone, when enabled | Self-service sign-up with a trial                           |

## API

| Method and path                               | Guard                                  |
| --------------------------------------------- | -------------------------------------- |
| `POST /v1/platform/tenants`                   | Platform administrator                 |
| `GET /v1/platform/tenants/:id`                | Platform administrator                 |
| `POST /v1/platform/tenants/:id/lifecycle`     | Platform administrator                 |
| `GET/POST /v1/platform/operators`             | Platform administrator (+ recent auth) |
| `DELETE /v1/platform/operators/:userId`       | Platform administrator + recent auth   |
| `GET/PUT /v1/tenant/branding`                 | Member / `settings.manage` tenant-wide |
| `GET /v1/tenant/export`                       | Organisation owner + recent auth       |
| `POST /v1/signup`, `POST /v1/signup/complete` | Public, rate limited, off by default   |

## Configuration

| Variable                      | Default | Meaning                                      |
| ----------------------------- | ------- | -------------------------------------------- |
| `SIGNUP_ENABLED`              | `false` | Turns on self-service sign-up                |
| `SIGNUP_PLAN`                 | `PRO`   | Plan code whose latest version is trialled   |
| `SIGNUP_BLOCK_FREE_EMAIL`     | `true`  | Refuse gmail.com and similar; ask for a work address |
| `SIGNUP_TTL_HOURS`            | `24`    | How long the emailed link works              |
| `SIGNUP_RATE_LIMIT_PER_IP`    | `10`    | Requests per hour per IP address             |
| `SIGNUP_RATE_LIMIT_PER_EMAIL` | `3`     | Requests per hour per email address          |
| `NEXT_PUBLIC_SIGNUP_ENABLED`  | unset   | Shows the "Create an organisation" link only |

## Tests

`apps/api/test/onboarding.int.test.ts`, `packages/database/test/org-rls.int.test.ts` (tenant guard, sign-up
request RLS), `packages/validation/src/onboarding.test.ts`, `apps/web/e2e/onboarding.spec.ts`.
