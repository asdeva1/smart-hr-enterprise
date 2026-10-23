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

## Deleting an organisation

Archiving keeps an organisation's data. **Delete organisation** (Platform → Organisations → the organisation → Delete) removes it permanently, and cannot be undone.

- Platform operators only, with a recent password entry (and second step, if on). The operator types the organisation's address and a reason.
- One database function, `platform_delete_tenant`, removes every row of the organisation in a single transaction, children before parents, working the order out from the foreign keys, so tables added later are covered. If anything fails, nothing is deleted. The append-only audit log is not touched, and a `platform.tenant.delete` event records who deleted what and why.
- Stored files are removed from storage afterwards; any that cannot be removed are reported so they can be cleared from the bucket by hand. The S3 credentials need `s3:DeleteObject`.
- Optionally, sign-in accounts that belonged only to this organisation are deleted too, so the same email address can sign up again. Platform operators, and people who also belong to another organisation, are never deleted.
- The sign-up page refuses an email address that already has an account, which is why the option above matters when an organisation is deleted to be re-created from the website.
