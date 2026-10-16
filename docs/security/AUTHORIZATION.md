# Authorization: organisations, roles and permissions

Status: implemented in Phase 3. Decision record: [ADR 0006](../decisions/0006-scoped-rbac.md).

Every request is authorised on the server. The web app hides what a member can't use, but that is only presentation; the API checks the permission, its scope, and row-level security underneath.

## Model

| Concept         | Table                     | Notes                                                                                 |
| --------------- | ------------------------- | ------------------------------------------------------------------------------------- |
| Organisation    | `tenant`                  | Owns everything below. `require_mfa` is its security policy.                          |
| Company         | `company`                 | Legal entity: country, base currency, IANA time zone.                                 |
| Branch          | `branch`                  | Location of a company.                                                                |
| Department      | `department`              | Belongs to a company; may nest under a parent department of the same company.         |
| Member          | `tenant_membership`       | A user's access to one organisation. `is_tenant_admin` marks an **owner**.            |
| Role            | `role`, `role_permission` | Named set of permission codes. Built-in roles are created for every organisation.     |
| Role assignment | `role_assignment`         | Member + role + **scope**: the whole organisation, one company, branch or department. |

Organisation records are archived, never deleted (the runtime database role has no `DELETE` on them).

## Permissions

Codes live in [`packages/shared/src/permissions.ts`](../../packages/shared/src/permissions.ts). Each phase adds its module's codes there; the API rejects unknown codes.

| Code                 | Allows                                                      |
| -------------------- | ----------------------------------------------------------- |
| `org.view`           | See companies, branches and departments                     |
| `org.manage`         | Create and change them                                      |
| `access.view`        | See members, roles and assignments                          |
| `access.manage`      | Invite members, manage roles and assignments                |
| `settings.manage`    | Change organisation settings                                |
| `security.manage`    | Change the organisation security policy                     |
| `audit.view`         | Read the audit log                                          |
| `approvals.view_all` | See every approval request in scope (oversight; not decide) |
| `approvals.manage`   | Publish approval policies (tenant-wide only)                |

Built-in roles: **Organisation administrator** (everything), **Access administrator**, **Auditor** (read-only), **Member** (`org.view`). They can't be edited or deleted. After each deployment's migrations, run `node apps/api/dist/cli/sync-system-roles.js` to bring every organisation's built-in roles up to date.

## Scopes

| Assignment scope | Covers                                                |
| ---------------- | ----------------------------------------------------- |
| Organisation     | Everything in the organisation                        |
| Company          | The company, its branches and its departments         |
| Branch           | That branch                                           |
| Department       | That department and every department nested inside it |

How a request is checked:

1. The guard re-reads the membership, the organisation's MFA policy and every role assignment **on each request** — a removed role or suspended member loses access immediately.
2. `@RequirePermission('org.manage')` requires the code at _some_ scope (cheap, early refusal).
3. The service then checks the code covers the **specific record**: e.g. editing a branch needs `org.manage` on that branch, its company, or the whole organisation. Lists are filtered the same way.
4. All queries run inside `withContext`, so PostgreSQL row-level security confines them to the organisation; an id from another organisation is simply not found (404).

## Escalation rules

Owners hold every permission and are exempt. For everyone else:

- **Granting:** assigning a role at a scope needs `access.manage` covering that scope **and** every permission in the role at that scope. An access administrator can hand out _Member_, but not _Organisation administrator_.
- **Self:** nobody changes their own role assignments or ownership.
- **Custom roles:** may contain only permissions the editor holds across the whole organisation. Editing a role needs the editor to hold what it already grants, because the change affects everyone who has it.
- **Built-in roles** are fixed.
- **Ownership:** only owners grant or remove it, and the last active owner can't be removed or suspended.
- **Suspension:** tenant-wide `access.manage`; owners can only be suspended by owners; nobody suspends themselves.

Each rule has an integration test in `apps/api/test/rbac.int.test.ts`; disabling the grant check or the scope check makes those tests fail (verified).

## Database guarantees

- RLS on every organisation and role table (`tenant_id = app_current_tenant_id()`), and a test that fails if any table with `tenant_id` lacks RLS.
- **Tenant-qualified foreign keys**: child rows reference `(tenant_id, parent_id)`. Foreign-key checks bypass RLS, so a plain `company_id` key would let a branch in one organisation point at another organisation's company — verified by test, which fails if the key is reverted to a plain one.
- The runtime role may update only `require_mfa` on its own tenant row.

## Organisation security policy

With **Require two-step verification** on, any member without it is refused on every organisation endpoint (`403 MFA_ENROLMENT_REQUIRED`) and the web app sends them to set it up; their own account pages keep working. An owner must turn it on for themselves before requiring it for everyone.

## Approvals

Deciding an approval needs no permission: being the task's assignee is the authority, checked by the engine, and anyone else gets 404. Requesters never approve their own requests, even as a delegate. Details: [APPROVALS_AND_NOTIFICATIONS.md](../modules/APPROVALS_AND_NOTIFICATIONS.md).

## Not yet implemented

| Item                           | Planned  | Acceptance criteria                                            |
| ------------------------------ | -------- | -------------------------------------------------------------- |
| Email change with verification | Phase 21 | Confirmation link to the new address and notice to the old one |

## Plans and the platform console

Plan features are a second, independent gate after permissions: a route marked `@RequireFeature` needs both
the permission and a plan that includes the feature. Expired or suspended organisations are read-only for
gated modules. See [ADR 0003](../decisions/0003-plans-and-entitlements.md).

Platform routes (`/v1/platform/*`) require a platform administrator and run their transactions as a
_platform actor_. Row-level security lets only platform actors write subscriptions, add-ons, overrides and
subscription history, and lets them list organisations only when no single organisation is in scope.

After each deployment's migrations, also run `node apps/api/dist/cli/sync-plan-catalogue.js`. It creates
missing starting plans and never changes plans that exist.

## Organisation lifecycle and operators

Only platform actors create organisations or change their name, slug, status and lifecycle dates. The API
enforces it on `/v1/platform/*`, and a database trigger (`tenant_guard`) refuses those changes from any
other transaction. While an organisation is offboarding, the guard refuses every unsafe HTTP method with
`TENANT_OFFBOARDING`, so members keep read and export access only. Suspended and archived organisations have
no access at all. Granting or revoking operator access needs a recent sign-in; operators cannot revoke
themselves, and the last operator cannot be removed. The full data export is limited to organisation owners
with a recent sign-in and is audited. See [ADR 0008](../decisions/0008-tenant-onboarding-and-lifecycle.md).

## Employee records

Employee lists and records are filtered to the scopes where the viewer holds `employees.view`; a department
scope covers its sub-departments. Identity and bank details need their own permissions, are encrypted under a
key ring separate from MFA, and full numbers are shown only after a recent password entry, with an audit
entry. See [EMPLOYEES.md](../modules/EMPLOYEES.md).
